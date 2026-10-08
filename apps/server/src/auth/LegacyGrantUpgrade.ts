import {
  AuthAdministrativeScopes,
  AuthEnvironmentScopes,
  type AuthEnvironmentScope,
  AuthStandardClientScopes,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Default grant sets issued before the granular-permission split. A stored
 * credential carrying exactly one of these sets was minted by a release whose
 * broad scopes implied full client (or administrative) access, so adopting the
 * granular model must not silently demote it to read-only.
 */
const LEGACY_STANDARD_CLIENT_SCOPES: ReadonlyArray<AuthEnvironmentScope> = [
  "orchestration:read",
  "orchestration:operate",
  "terminal:operate",
  "review:write",
  "relay:read",
];
const LEGACY_ADMINISTRATIVE_SCOPES: ReadonlyArray<AuthEnvironmentScope> = [
  ...LEGACY_STANDARD_CLIENT_SCOPES,
  "access:read",
  "access:write",
  "relay:write",
];

const LEGACY_STANDARD_SET = new Set<string>(LEGACY_STANDARD_CLIENT_SCOPES);
const LEGACY_ADMINISTRATIVE_SET = new Set<string>(LEGACY_ADMINISTRATIVE_SCOPES);

const setsEqual = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
  left.size === right.size && [...left].every((value) => right.has(value));

/**
 * The current default grant that replaces a whole legacy default, or null for
 * anything else. Explicitly narrowed grants are preserved untouched.
 */
export function resolveLegacyGrantUpgrade(
  scopes: ReadonlyArray<AuthEnvironmentScope>,
): ReadonlyArray<AuthEnvironmentScope> | null {
  const set = new Set<string>(scopes);
  if (setsEqual(set, LEGACY_ADMINISTRATIVE_SET)) return AuthAdministrativeScopes;
  if (setsEqual(set, LEGACY_STANDARD_SET)) return AuthStandardClientScopes;
  return null;
}

const decodeScopes = Schema.decodeUnknownOption(Schema.fromJsonString(AuthEnvironmentScopes));
const encodeScopes = Schema.encodeSync(Schema.fromJsonString(AuthEnvironmentScopes));

/**
 * Moves stored sessions and pairing links from the pre-granular default grants
 * to the current ones. Runs once per startup and is a no-op once every stored
 * grant is current, so re-running it after future scope additions keeps old
 * default grants working.
 */
export const upgradeLegacyDefaultAuthGrants = Effect.fn("upgradeLegacyDefaultAuthGrants")(
  function* () {
    const sql = yield* SqlClient.SqlClient;

    const sessionRows = yield* sql<{ readonly session_id: string; readonly scopes: string }>`
      SELECT session_id, scopes FROM auth_sessions
    `;
    const linkRows = yield* sql<{ readonly id: string; readonly scopes: string }>`
      SELECT id, scopes FROM auth_pairing_links
    `;

    let upgraded = 0;
    for (const row of sessionRows) {
      const scopes = Option.getOrElse(decodeScopes(row.scopes), () => null);
      const next = scopes === null ? null : resolveLegacyGrantUpgrade(scopes);
      if (next === null) continue;
      yield* sql`UPDATE auth_sessions SET scopes = ${encodeScopes(next)} WHERE session_id = ${row.session_id}`;
      upgraded++;
    }
    for (const row of linkRows) {
      const scopes = Option.getOrElse(decodeScopes(row.scopes), () => null);
      const next = scopes === null ? null : resolveLegacyGrantUpgrade(scopes);
      if (next === null) continue;
      yield* sql`UPDATE auth_pairing_links SET scopes = ${encodeScopes(next)} WHERE id = ${row.id}`;
      upgraded++;
    }

    if (upgraded > 0) {
      yield* Effect.log("Upgraded legacy default auth grants to granular permissions").pipe(
        Effect.annotateLogs({ upgraded }),
      );
    }
  },
);
