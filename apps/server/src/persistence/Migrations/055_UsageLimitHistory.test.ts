import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))("055_UsageLimitHistory", (it) => {
  it.effect("creates the sampled limit history table and lookup index", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 55 });

      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(usage_limit_samples)`;
      const indexes = yield* sql<{ readonly name: string }>`PRAGMA index_list(usage_limit_samples)`;

      assert.isTrue(columns.some((column) => column.name === "used_percent"));
      assert.isTrue(indexes.some((index) => index.name === "usage_limit_samples_observed"));
    }),
  );
});
