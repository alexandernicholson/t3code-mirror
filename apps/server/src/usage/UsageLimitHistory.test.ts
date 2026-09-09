import { assert, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  UsageLimitSourceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { UsageLimitSources } from "./UsageLimitSources.ts";
import { UsageLimitHistory, layer } from "./UsageLimitHistory.ts";

const now = Date.parse("2026-09-09T12:00:00.000Z");

const provider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated", email: "person@example.com" },
  checkedAt: "2026-09-09T11:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  usageLimits: {
    checkedAt: "2026-09-09T11:00:00.000Z",
    windows: [
      { id: "five_hour", kind: "session", label: "Session", usedPercent: 42 },
      { id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 18 },
    ],
  },
} satisfies ServerProvider;

it.effect("records every native and source limit window and reads bounded series", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(now);
    const testLayer = layer.pipe(
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provide(
        Layer.mock(ProviderRegistry)({
          getProviders: Effect.succeed([provider]),
          streamChanges: Stream.empty,
        }),
      ),
      Layer.provide(
        Layer.mock(UsageLimitSources)({
          current: Effect.succeed([
            {
              id: UsageLimitSourceId.make("proxy"),
              kind: "cliproxy",
              label: "Proxy",
              checkedAt: "2026-09-09T11:05:00.000Z",
              accounts: [
                {
                  id: "account.json",
                  driver: ProviderDriverKind.make("claudeAgent"),
                  email: "other@example.com",
                  usageLimits: {
                    checkedAt: "2026-09-09T11:05:00.000Z",
                    windows: [
                      { id: "five_hour", kind: "session", label: "Session", usedPercent: 63 },
                    ],
                  },
                },
              ],
            },
          ]),
          streamChanges: Stream.empty,
        }),
      ),
    );
    const context = yield* Layer.build(testLayer);
    const history = Context.get(context, UsageLimitHistory);
    const result = yield* history.read({
      since: "2026-09-09T10:00:00.000Z",
      until: "2026-09-09T12:00:00.000Z",
      bucketMinutes: 5,
    });

    assert.equal(result.series.length, 3);
    assert.deepStrictEqual(
      result.series.map((series) => [
        series.driver,
        series.windowKind,
        series.points[0]?.usedPercent,
      ]),
      [
        [ProviderDriverKind.make("codex"), "session", 42],
        [ProviderDriverKind.make("codex"), "weekly", 18],
        [ProviderDriverKind.make("claudeAgent"), "session", 63],
      ],
    );
    assert.deepStrictEqual(result.series[0]?.origin, {
      kind: "provider",
      instanceId: ProviderInstanceId.make("codex"),
    });
    assert.deepStrictEqual(result.series[2]?.origin, {
      kind: "source",
      sourceId: UsageLimitSourceId.make("proxy"),
      accountId: "account.json",
    });
  }),
);
