import { SourceBuild } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { incompatibleMigration } from "./migrations.ts";

declare const __T3CODE_SOURCE_BUILD__: unknown;

/** Embedded by the source builder; ordinary packages and dev servers cannot activate source updates. */
export const sourceBuild =
  typeof __T3CODE_SOURCE_BUILD__ === "undefined" || __T3CODE_SOURCE_BUILD__ === null
    ? null
    : Schema.decodeUnknownSync(SourceBuild)(__T3CODE_SOURCE_BUILD__);

export function assertCompatibleMigrations(current: SourceBuild, target: SourceBuild): void {
  const id = incompatibleMigration(current.migrations, target.migrations);
  if (id !== null) {
    throw new Error(
      `This branch cannot read the installed database: migration ${id} is missing, changed, or out of order. Return to a compatible branch.`,
    );
  }
}
