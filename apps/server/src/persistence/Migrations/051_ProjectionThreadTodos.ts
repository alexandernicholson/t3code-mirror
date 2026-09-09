import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_threads ADD COLUMN todos_json TEXT`;
  // Existing checklist activities are immutable history. Seed each thread from
  // its latest snapshot, including an explicit empty list, before the old
  // progress-only drawer is replaced by the persistent surface.
  yield* sql`
    WITH latest AS (
      SELECT thread_id, payload_json,
        ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY sequence DESC, created_at DESC, activity_id DESC) AS rank
      FROM projection_thread_activities
      WHERE kind = 'turn.plan.updated' AND json_valid(payload_json)
    ), snapshots AS (
      SELECT thread_id, (
        SELECT json_group_array(json_object(
          'id', 'native:legacy:' || entry.key,
          'content', trim(json_extract(entry.value, '$.step')),
          'phase', 'Tasks',
          'status', CASE json_extract(entry.value, '$.status')
            WHEN 'completed' THEN 'completed'
            WHEN 'inProgress' THEN 'in_progress'
            WHEN 'in_progress' THEN 'in_progress'
            ELSE 'pending' END
        ))
        FROM json_each(latest.payload_json, '$.plan') AS entry
        WHERE json_type(entry.value, '$.step') = 'text'
          AND length(trim(json_extract(entry.value, '$.step'))) BETWEEN 1 AND 2000
          AND CAST(entry.key AS INTEGER) < 500
      ) AS items
      FROM latest WHERE rank = 1 AND json_type(payload_json, '$.plan') = 'array'
    )
    UPDATE projection_threads SET todos_json = (
      SELECT json_object('revision', 1, 'items', json(items), 'nativeItems', json(items))
      FROM snapshots WHERE snapshots.thread_id = projection_threads.thread_id
    ) WHERE thread_id IN (SELECT thread_id FROM snapshots)
  `;
});
