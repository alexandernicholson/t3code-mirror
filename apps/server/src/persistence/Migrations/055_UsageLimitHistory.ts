import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE usage_limit_samples (
      account_key TEXT NOT NULL,
      origin_kind TEXT NOT NULL,
      origin_id TEXT NOT NULL,
      source_account_id TEXT,
      driver TEXT NOT NULL,
      window_id TEXT NOT NULL,
      window_kind TEXT NOT NULL,
      window_label TEXT NOT NULL,
      bucket_start INTEGER NOT NULL,
      observed_at INTEGER NOT NULL,
      used_percent REAL NOT NULL,
      resets_at TEXT,
      PRIMARY KEY (account_key, window_kind, window_id, bucket_start)
    )
  `;
  yield* sql`
    CREATE INDEX usage_limit_samples_observed
    ON usage_limit_samples(observed_at)
  `;
});
