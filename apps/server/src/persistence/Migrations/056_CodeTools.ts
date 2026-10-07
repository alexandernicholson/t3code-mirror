import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE code_tools_configurations (scope_key TEXT PRIMARY KEY, body TEXT NOT NULL)`;
});
