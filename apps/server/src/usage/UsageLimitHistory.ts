import {
  UsageLimitHistoryError,
  ProviderInstanceId,
  UsageLimitSourceId,
  type ServerProvider,
  type UsageLimitHistory as UsageLimitHistoryValue,
  type UsageLimitHistoryInput,
  type UsageLimitHistorySeries,
  type UsageLimitSourceSnapshot,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { SqlClient } from "effect/unstable/sql";

import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { UsageLimitSources } from "./UsageLimitSources.ts";

const SAMPLE_BUCKET_MS = 5 * 60_000;
const RETENTION_MS = 90 * 24 * 60 * 60_000;
const formatIsoMillis = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

interface Sample {
  readonly accountKey: string;
  readonly originKind: "provider" | "source";
  readonly originId: string;
  readonly sourceAccountId: string | null;
  readonly driver: string;
  readonly windowId: string;
  readonly windowKind: string;
  readonly windowLabel: string;
  readonly observedAt: number;
  readonly usedPercent: number;
  readonly resetsAt: string | null;
}

interface SampleRow {
  readonly account_key: string;
  readonly origin_kind: "provider" | "source";
  readonly origin_id: string;
  readonly source_account_id: string | null;
  readonly driver: UsageLimitHistorySeries["driver"];
  readonly window_id: string;
  readonly window_kind: UsageLimitHistorySeries["windowKind"];
  readonly window_label: string;
  readonly observed_at: number;
  readonly used_percent: number;
  readonly resets_at: string | null;
}

function providerSamples(providers: readonly ServerProvider[]): readonly Sample[] {
  return providers.flatMap((provider) => {
    const limits = provider.usageLimits;
    const observedAt = limits ? Date.parse(limits.checkedAt) : Number.NaN;
    if (!limits || limits.unavailable || !Number.isFinite(observedAt)) return [];
    return limits.windows.map((window) => ({
      accountKey: `provider:${provider.instanceId}`,
      originKind: "provider" as const,
      originId: provider.instanceId,
      sourceAccountId: null,
      driver: provider.driver,
      windowId: window.id,
      windowKind: window.kind,
      windowLabel: window.label,
      observedAt,
      usedPercent: window.usedPercent,
      resetsAt: window.resetsAt ?? null,
    }));
  });
}

function sourceSamples(sources: readonly UsageLimitSourceSnapshot[]): readonly Sample[] {
  return sources.flatMap((source) =>
    source.accounts.flatMap((account) => {
      const limits = account.usageLimits;
      const observedAt = Date.parse(limits.checkedAt);
      if (limits.unavailable || !Number.isFinite(observedAt)) return [];
      return limits.windows.map((window) => ({
        accountKey: `source:${source.id}:${account.id}`,
        originKind: "source" as const,
        originId: source.id,
        sourceAccountId: account.id,
        driver: account.driver,
        windowId: window.id,
        windowKind: window.kind,
        windowLabel: window.label,
        observedAt,
        usedPercent: window.usedPercent,
        resetsAt: window.resetsAt ?? null,
      }));
    }),
  );
}

export class UsageLimitHistory extends Context.Service<
  UsageLimitHistory,
  {
    readonly read: (
      input: UsageLimitHistoryInput,
    ) => Effect.Effect<UsageLimitHistoryValue, UsageLimitHistoryError>;
  }
>()("t3/usage/UsageLimitHistory") {}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const providers = yield* ProviderRegistry;
  const sources = yield* UsageLimitSources;

  const record = Effect.fn("UsageLimitHistory.record")(function* (samples: readonly Sample[]) {
    if (samples.length === 0) return;
    yield* sql.withTransaction(
      Effect.forEach(
        samples,
        (sample) => {
          const bucketStart = Math.floor(sample.observedAt / SAMPLE_BUCKET_MS) * SAMPLE_BUCKET_MS;
          return sql`
            INSERT INTO usage_limit_samples (
              account_key, origin_kind, origin_id, source_account_id, driver,
              window_id, window_kind, window_label, bucket_start, observed_at,
              used_percent, resets_at
            ) VALUES (
              ${sample.accountKey}, ${sample.originKind}, ${sample.originId},
              ${sample.sourceAccountId}, ${sample.driver},
              ${sample.windowId}, ${sample.windowKind}, ${sample.windowLabel},
              ${bucketStart}, ${sample.observedAt}, ${sample.usedPercent}, ${sample.resetsAt}
            )
            ON CONFLICT(account_key, window_kind, window_id, bucket_start) DO UPDATE SET
              driver = excluded.driver,
              window_label = excluded.window_label,
              observed_at = excluded.observed_at,
              used_percent = excluded.used_percent,
              resets_at = excluded.resets_at
            WHERE excluded.observed_at >= usage_limit_samples.observed_at
          `;
        },
        { discard: true },
      ),
    );
  });

  const [initialProviders, initialSources] = yield* Effect.all([
    providers.getProviders,
    sources.current,
  ]);
  yield* record([...providerSamples(initialProviders), ...sourceSamples(initialSources)]).pipe(
    Effect.ignoreCause({ log: true }),
  );

  const providerStream = providers.streamChanges.pipe(Stream.map(providerSamples));
  yield* Stream.merge(providerStream, sources.streamChanges.pipe(Stream.map(sourceSamples))).pipe(
    Stream.runForEach((samples) => record(samples).pipe(Effect.ignoreCause({ log: true }))),
    Effect.forkScoped,
  );

  const prune = Clock.currentTimeMillis.pipe(
    Effect.flatMap(
      (now) => sql`DELETE FROM usage_limit_samples WHERE observed_at < ${now - RETENTION_MS}`,
    ),
    Effect.ignoreCause({ log: true }),
  );
  yield* prune;
  yield* Effect.forever(Effect.sleep(Duration.days(1)).pipe(Effect.andThen(prune))).pipe(
    Effect.forkScoped,
  );

  const read = Effect.fn("UsageLimitHistory.read")(
    function* (input: UsageLimitHistoryInput) {
      const requestedSince = Date.parse(input.since);
      const requestedUntil = Date.parse(input.until);
      if (
        !Number.isFinite(requestedSince) ||
        !Number.isFinite(requestedUntil) ||
        requestedUntil <= requestedSince
      ) {
        return yield* new UsageLimitHistoryError({ detail: "The history window is invalid." });
      }
      const now = yield* Clock.currentTimeMillis;
      const until = Math.min(requestedUntil, now);
      const since = Math.max(requestedSince, until - RETENTION_MS);
      const rows = yield* sql<SampleRow>`
        SELECT account_key, origin_kind, origin_id, source_account_id, driver,
             window_id, window_kind, window_label, observed_at, used_percent, resets_at
      FROM usage_limit_samples
      WHERE observed_at >= ${since} AND observed_at < ${until}
      ORDER BY observed_at ASC
    `;
      const outputBucketMs = input.bucketMinutes * 60_000;
      const grouped = new Map<string, { row: SampleRow; points: Map<number, SampleRow> }>();
      for (const row of rows) {
        const key = `${row.account_key}\u0000${row.window_kind}\u0000${row.window_id}`;
        const group = grouped.get(key) ?? { row, points: new Map<number, SampleRow>() };
        const bucket = Math.floor(row.observed_at / outputBucketMs) * outputBucketMs;
        const previous = group.points.get(bucket);
        if (!previous || row.observed_at >= previous.observed_at) group.points.set(bucket, row);
        grouped.set(key, group);
      }
      const series: UsageLimitHistorySeries[] = [...grouped.values()].map(({ row, points }) => ({
        origin:
          row.origin_kind === "provider"
            ? { kind: "provider", instanceId: ProviderInstanceId.make(row.origin_id) }
            : {
                kind: "source",
                sourceId: UsageLimitSourceId.make(row.origin_id),
                accountId: row.source_account_id ?? row.account_key,
              },
        driver: row.driver,
        windowId: row.window_id,
        windowKind: row.window_kind,
        label: row.window_label,
        points: [...points.values()].map((point) => ({
          observedAt: formatIsoMillis(point.observed_at),
          usedPercent: point.used_percent,
          ...(point.resets_at ? { resetsAt: point.resets_at } : {}),
        })),
      }));
      return {
        readAt: formatIsoMillis(now),
        since: formatIsoMillis(since),
        until: formatIsoMillis(until),
        series,
      };
    },
    Effect.catchTag(
      "SqlError",
      () => new UsageLimitHistoryError({ detail: "Usage-limit history is unavailable." }),
    ),
  );

  return UsageLimitHistory.of({ read });
});

export const layer = Layer.effect(UsageLimitHistory, make);

export const layerTest = Layer.succeed(
  UsageLimitHistory,
  UsageLimitHistory.of({
    read: (input) =>
      Effect.succeed({
        readAt: input.until,
        since: input.since,
        until: input.until,
        series: [],
      }),
  }),
);
