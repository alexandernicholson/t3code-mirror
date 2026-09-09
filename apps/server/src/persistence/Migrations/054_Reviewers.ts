import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE reviewer_configuration (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL)`;
  yield* sql`CREATE TABLE reviewer_runs (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, body TEXT NOT NULL)`;
  yield* sql`CREATE INDEX reviewer_runs_thread ON reviewer_runs(thread_id)`;
  yield* sql`CREATE TABLE reviewer_findings (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, thread_id TEXT NOT NULL, body TEXT NOT NULL)`;
  yield* sql`CREATE INDEX reviewer_findings_thread ON reviewer_findings(thread_id)`;
});
