import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { ThreadTodos } from "@t3tools/contracts";
import { runMigrations } from "../Migrations.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeTodos = Schema.decodeUnknownSync(Schema.fromJsonString(ThreadTodos));
it.layer(NodeSqliteClient.layerMemory())("051_ProjectionThreadTodos", (it) => {
  it.effect(
    "backfills the latest checklist including explicit clears, without changing thread timestamps",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 50 });
        const now = "2026-09-09T00:00:00.000Z";
        for (const threadId of ["tasks", "cleared", "untouched"]) {
          yield* sql`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode, created_at, updated_at) VALUES (${threadId}, 'project', 'Thread', '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', ${now}, ${now})`;
        }
        const old = encodeJson({ plan: [{ step: "Old", status: "pending" }] });
        const latest = encodeJson({
          plan: [
            { step: " Review ", status: "completed" },
            { step: "Build", status: "inProgress" },
          ],
        });
        for (const [id, threadId, sequence, payload] of [
          ["old", "tasks", 1, old],
          ["latest", "tasks", 2, latest],
          ["clear-old", "cleared", 3, old],
          ["clear", "cleared", 4, '{"plan":[]}'],
        ] as const) {
          yield* sql`INSERT INTO projection_thread_activities (activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at) VALUES (${id}, ${threadId}, 'turn', 'info', 'turn.plan.updated', 'Plan updated', ${payload}, ${sequence}, ${now})`;
        }
        yield* runMigrations({ toMigrationInclusive: 51 });
        const rows = yield* sql<{
          threadId: string;
          todos: string | null;
          updatedAt: string;
        }>`SELECT thread_id AS "threadId", todos_json AS todos, updated_at AS "updatedAt" FROM projection_threads ORDER BY thread_id`;
        const tasks = decodeTodos(rows.find((row) => row.threadId === "tasks")!.todos);
        assert.deepEqual(
          tasks.items.map((item) => [item.content, item.status]),
          [
            ["Review", "completed"],
            ["Build", "in_progress"],
          ],
        );
        assert.deepEqual(tasks.nativeItems, tasks.items);
        assert.deepEqual(
          decodeTodos(rows.find((row) => row.threadId === "cleared")!.todos).items,
          [],
        );
        assert.equal(rows.find((row) => row.threadId === "untouched")!.todos, null);
        assert.isTrue(rows.every((row) => row.updatedAt === now));
      }),
  );
});
