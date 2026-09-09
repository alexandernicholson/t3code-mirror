import {
  AdvisorConfiguration,
  AdvisorEntry,
  AdvisorError,
  AdvisorState,
  advisorScopeKey,
  type AdvisorSubscriptionInput,
} from "@t3tools/contracts";
import { Context, Effect, Layer, Schema, Semaphore, Stream, SubscriptionRef } from "effect";
import { SqlClient } from "effect/unstable/sql";

const decodeConfiguration = Schema.decodeEffect(Schema.fromJsonString(AdvisorConfiguration));
const decodeState = Schema.decodeEffect(Schema.fromJsonString(AdvisorState));
const decodeEntry = Schema.decodeEffect(Schema.fromJsonString(AdvisorEntry));
const encodeConfiguration = Schema.encodeEffect(Schema.fromJsonString(AdvisorConfiguration));
const encodeState = Schema.encodeEffect(Schema.fromJsonString(AdvisorState));
const encodeEntry = Schema.encodeEffect(Schema.fromJsonString(AdvisorEntry));

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* SubscriptionRef.make<Readonly<Record<string, number>>>({
    configuration: 0,
  });
  const mutex = yield* Semaphore.make(1);
  const notify = (key: string) =>
    SubscriptionRef.update(changes, (revisions) => ({
      ...revisions,
      [key]: (revisions[key] ?? 0) + 1,
    }));
  const configurations = Effect.fn("AdvisorStore.configurations")(function* () {
    const rows = yield* sql<{ body: string }>`SELECT body FROM advisor_configurations`;
    return yield* Effect.forEach(rows, (row) => decodeConfiguration(row.body));
  });
  const states = Effect.fn("AdvisorStore.states")(function* (threadId?: string) {
    const rows =
      threadId === undefined
        ? yield* sql<{ body: string }>`SELECT body FROM advisor_states`
        : yield* sql<{
            body: string;
          }>`SELECT body FROM advisor_states WHERE thread_id = ${threadId}`;
    return yield* Effect.forEach(rows, (row) => decodeState(row.body));
  });
  const entries = Effect.fn("AdvisorStore.entries")(function* (threadId: string) {
    const rows = yield* sql<{
      body: string;
    }>`SELECT body FROM advisor_entries WHERE thread_id = ${threadId} ORDER BY sequence DESC LIMIT 300`;
    return yield* Effect.forEach(rows.toReversed(), (row) => decodeEntry(row.body));
  });
  const saveConfiguration = Effect.fn("AdvisorStore.saveConfiguration")(function* (
    input: AdvisorConfiguration,
  ) {
    const key = advisorScopeKey(input.scope);
    const current = (yield* configurations()).find((value) => advisorScopeKey(value.scope) === key);
    if ((current?.revision ?? 0) !== input.revision)
      return yield* new AdvisorError({
        message: "These advisor settings changed on another device. Reload and try again.",
      });
    const body = yield* encodeConfiguration({
      ...input,
      revision: input.revision + 1,
    });
    yield* sql`INSERT INTO advisor_configurations(scope_key, body) VALUES (${key}, ${body}) ON CONFLICT(scope_key) DO UPDATE SET body = excluded.body`;
    yield* notify("configuration");
  }, mutex.withPermits(1));
  const saveState = Effect.fn("AdvisorStore.saveState")(function* (state: AdvisorState) {
    yield* sql`INSERT INTO advisor_states(thread_id, advisor_id, body) VALUES (${state.threadId}, ${state.advisorId}, ${yield* encodeState(state)}) ON CONFLICT(thread_id, advisor_id) DO UPDATE SET body = excluded.body`;
    yield* notify(state.threadId);
  });
  const append = Effect.fn("AdvisorStore.append")(function* (entry: AdvisorEntry) {
    yield* sql`INSERT OR IGNORE INTO advisor_entries(id, thread_id, advisor_id, body) VALUES (${entry.id}, ${entry.threadId}, ${entry.advisorId}, ${yield* encodeEntry(entry)})`;
    yield* notify(entry.threadId);
  });
  const removeState = Effect.fn("AdvisorStore.removeState")(function* (
    threadId: string,
    advisorId: string,
  ) {
    yield* sql`DELETE FROM advisor_states WHERE thread_id = ${threadId} AND advisor_id = ${advisorId}`;
    yield* notify(threadId);
  });
  const removeThread = Effect.fn("AdvisorStore.removeThread")(function* (threadId: string) {
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`DELETE FROM advisor_entries WHERE thread_id = ${threadId}`;
        yield* sql`DELETE FROM advisor_states WHERE thread_id = ${threadId}`;
        yield* sql`DELETE FROM advisor_configurations WHERE scope_key = ${`thread:${threadId}`}`;
      }),
    );
    yield* notify(threadId);
  });
  const snapshot = Effect.fn("AdvisorStore.snapshot")(function* (
    input: typeof AdvisorSubscriptionInput.Type,
  ) {
    const timeline = input.threadId && input.details ? yield* entries(input.threadId) : [];
    const summary = input.threadId
      ? yield* sql<{
          id: string;
          findings: number;
        }>`SELECT (SELECT id FROM advisor_entries WHERE thread_id = ${input.threadId} ORDER BY sequence DESC LIMIT 1) AS id, COUNT(*) AS findings FROM advisor_entries WHERE thread_id = ${input.threadId} AND json_extract(body, '$.kind') = 'finding'`
      : [];
    return {
      configurations: yield* configurations(),
      states: input.threadId ? yield* states(input.threadId) : [],
      entries: input.details ? timeline : [],
      latestEntryId: summary[0]?.id ?? null,
      findingCount: summary[0]?.findings ?? 0,
    };
  });
  return {
    configurations,
    states,
    entries,
    saveConfiguration,
    saveState,
    append,
    removeThread,
    removeState,
    subscribe: (input: typeof AdvisorSubscriptionInput.Type) =>
      SubscriptionRef.changes(changes).pipe(
        Stream.map(
          (revision) =>
            `${revision.configuration}:${input.threadId ? (revision[input.threadId] ?? 0) : 0}`,
        ),
        Stream.changes,
        Stream.mapEffect(() => snapshot(input)),
        Stream.mapError(() => new AdvisorError({ message: "Advisor history is unavailable." })),
      ),
  };
});
export class AdvisorStore extends Context.Service<AdvisorStore, Effect.Success<typeof make>>()(
  "t3/advisors/AdvisorStore",
) {}
export const layer = Layer.effect(AdvisorStore, make);
