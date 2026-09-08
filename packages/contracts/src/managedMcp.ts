import * as Schema from "effect/Schema";
import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

// OpenCode configures MCP on a shared server, rather than an individual session.
// Until it can isolate that configuration, it must not receive scoped servers.
export const MANAGED_MCP_PROVIDERS = [
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "antigravity",
] as const;
export const ManagedMcpProvider = Schema.Literals(MANAGED_MCP_PROVIDERS);
export const ManagedMcpServerName = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
  Schema.makeFilter((value) => value !== "t3-code"),
);
export const McpEnvironmentVariableName = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
);
export const ManagedMcpConnection = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("http"),
    url: TrimmedNonEmptyString.check(
      Schema.makeFilter((value) => {
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !url.hash
          );
        } catch {
          return false;
        }
      }),
    ),
    bearerTokenEnvVar: Schema.optionalKey(McpEnvironmentVariableName),
  }),
  Schema.Struct({
    type: Schema.Literal("stdio"),
    command: TrimmedNonEmptyString,
    args: Schema.Array(Schema.String),
    envVars: Schema.Array(McpEnvironmentVariableName),
  }),
]);
export const ManagedMcpServer = Schema.Struct({
  enabled: Schema.Boolean,
  connection: ManagedMcpConnection,
  providers: Schema.Array(ManagedMcpProvider).check(Schema.isMinLength(1)),
  // Empty means every project in this environment.
  projectIds: Schema.Array(ProjectId),
});
export type ManagedMcpServer = typeof ManagedMcpServer.Type;
export const ManagedMcpServers = Schema.Record(ManagedMcpServerName, ManagedMcpServer);
export type ManagedMcpServers = typeof ManagedMcpServers.Type;

export function selectManagedMcpServers(
  servers: ManagedMcpServers,
  provider: string,
  projectId: ProjectId | undefined,
): ManagedMcpServers {
  return Object.fromEntries(
    Object.entries(servers).filter(
      ([, server]) =>
        server.enabled &&
        server.providers.some((kind) => kind === provider) &&
        (server.projectIds.length === 0 ||
          (projectId !== undefined && server.projectIds.includes(projectId))),
    ),
  );
}
