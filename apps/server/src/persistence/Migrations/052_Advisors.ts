import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE advisor_configurations (scope_key TEXT PRIMARY KEY, body TEXT NOT NULL)`;
  yield* sql`CREATE TABLE advisor_states (thread_id TEXT NOT NULL, advisor_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(thread_id, advisor_id))`;
  yield* sql`CREATE TABLE advisor_entries (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, thread_id TEXT NOT NULL, advisor_id TEXT NOT NULL, body TEXT NOT NULL)`;
  yield* sql`CREATE INDEX advisor_entries_thread ON advisor_entries(thread_id, sequence)`;
});
