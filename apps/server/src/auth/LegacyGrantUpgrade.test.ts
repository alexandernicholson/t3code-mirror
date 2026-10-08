import { assert, it } from "@effect/vitest";
import { AuthAdministrativeScopes, AuthStandardClientScopes } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { resolveLegacyGrantUpgrade, upgradeLegacyDefaultAuthGrants } from "./LegacyGrantUpgrade.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

const LEGACY_STANDARD = [
  "orchestration:read",
  "orchestration:operate",
  "terminal:operate",
  "review:write",
  "relay:read",
] as const;
const LEGACY_ADMINISTRATIVE = [
  ...LEGACY_STANDARD,
  "access:read",
  "access:write",
  "relay:write",
] as const;

const insertSession = (sessionId: string, scopes: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO auth_sessions (session_id, subject, scopes, method, issued_at, expires_at)
      VALUES (${sessionId}, 'test', ${JSON.stringify(scopes)}, 'browser-session-cookie', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')
    `;
  });

const insertLink = (id: string, scopes: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const credential = `credential-${id}`;
    yield* sql`
      INSERT INTO auth_pairing_links (id, credential, method, scopes, subject, created_at, expires_at)
      VALUES (${id}, ${credential}, 'one-time-token', ${JSON.stringify(scopes)}, 'test', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')
    `;
  });

const readSessionScopes = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly session_id: string; readonly scopes: string }>`
    SELECT session_id, scopes FROM auth_sessions ORDER BY session_id
  `;
  return Object.fromEntries(
    rows.map((row) => [row.session_id, JSON.parse(row.scopes) as ReadonlyArray<string>]),
  );
});

const readLinkScopes = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly id: string; readonly scopes: string }>`
    SELECT id, scopes FROM auth_pairing_links ORDER BY id
  `;
  return Object.fromEntries(
    rows.map((row) => [row.id, JSON.parse(row.scopes) as ReadonlyArray<string>]),
  );
});

layer("LegacyGrantUpgrade", (it) => {
  it.effect("upgrades whole legacy default grants and preserves explicit ones", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      yield* insertSession("legacy-standard", LEGACY_STANDARD);
      yield* insertSession("legacy-administrative", LEGACY_ADMINISTRATIVE);
      yield* insertSession("explicitly-narrowed", ["orchestration:read"]);
      yield* insertSession("current", AuthStandardClientScopes);
      yield* insertLink("legacy-link", LEGACY_STANDARD);
      yield* insertLink("explicit-link", ["orchestration:read", "terminal:operate"]);

      yield* upgradeLegacyDefaultAuthGrants();
      // A second run must be a no-op.
      yield* upgradeLegacyDefaultAuthGrants();

      const sessions = yield* readSessionScopes;
      const links = yield* readLinkScopes;

      assert.deepStrictEqual(sessions["legacy-standard"], [...AuthStandardClientScopes]);
      assert.deepStrictEqual(sessions["legacy-administrative"], [...AuthAdministrativeScopes]);
      assert.deepStrictEqual(sessions["explicitly-narrowed"], ["orchestration:read"]);
      assert.deepStrictEqual(sessions["current"], [...AuthStandardClientScopes]);
      assert.deepStrictEqual(links["legacy-link"], [...AuthStandardClientScopes]);
      assert.deepStrictEqual(links["explicit-link"], ["orchestration:read", "terminal:operate"]);
    }),
  );

  it("resolveLegacyGrantUpgrade only matches complete legacy defaults", () => {
    assert.deepStrictEqual(
      resolveLegacyGrantUpgrade([...LEGACY_STANDARD]),
      AuthStandardClientScopes,
    );
    assert.deepStrictEqual(
      resolveLegacyGrantUpgrade([...LEGACY_ADMINISTRATIVE]),
      AuthAdministrativeScopes,
    );
    assert.isNull(resolveLegacyGrantUpgrade(["orchestration:read"]));
    assert.isNull(resolveLegacyGrantUpgrade([...LEGACY_STANDARD, "settings:write"]));
    assert.isNull(resolveLegacyGrantUpgrade([]));
  });
});
