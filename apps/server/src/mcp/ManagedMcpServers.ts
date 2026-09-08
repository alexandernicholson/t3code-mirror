import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ProviderAdapterValidationError } from "../provider/Errors.ts";
import type { ManagedMcpServers, ThreadId } from "@t3tools/contracts";

const serversByThread = new Map<ThreadId, ManagedMcpServers>();

export function setManagedMcpServers(threadId: ThreadId, servers: ManagedMcpServers): void {
  serversByThread.set(threadId, servers);
}
export function clearManagedMcpServers(threadId: ThreadId): void {
  serversByThread.delete(threadId);
}
export function readManagedMcpServers(threadId: ThreadId): ManagedMcpServers {
  return serversByThread.get(threadId) ?? {};
}

type Environment = Readonly<Record<string, string | undefined>>;

function requireVariable(environment: Environment, name: string): string {
  const value = environment[name];
  if (!value)
    throw new Error(
      `MCP requires environment variable ${name}. Set it in the provider's environment settings.`,
    );
  return value;
}

/** Resolve credentials only inside the provider adapter; values never enter settings responses. */
export function toClaudeMcpServers(servers: ManagedMcpServers, environment: Environment) {
  return Object.fromEntries(
    Object.entries(servers).map(([name, { connection }]) => [
      name,
      connection.type === "http"
        ? {
            type: "http" as const,
            url: connection.url,
            ...(connection.bearerTokenEnvVar
              ? {
                  headers: {
                    Authorization: `Bearer ${requireVariable(environment, connection.bearerTokenEnvVar)}`,
                  },
                }
              : {}),
          }
        : {
            type: "stdio" as const,
            command: connection.command,
            args: [...connection.args],
            env: Object.fromEntries(
              connection.envVars.map((name) => [name, requireVariable(environment, name)]),
            ),
          },
    ]),
  );
}

export function toAcpMcpServers(servers: ManagedMcpServers, environment: Environment) {
  return Object.entries(toClaudeMcpServers(servers, environment)).map(([name, connection]) =>
    connection.type === "http"
      ? {
          type: "http" as const,
          name,
          url: connection.url,
          headers: Object.entries(connection.headers ?? {}).map(([name, value]) => ({
            name,
            value,
          })),
        }
      : {
          name,
          command: connection.command,
          args: connection.args,
          env: Object.entries(connection.env).map(([name, value]) => ({ name, value })),
        },
  );
}

const encodeTomlValue = Schema.encodeSync(
  Schema.fromJsonString(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
);

/** Codex reads TOML overrides. JSON strings and string arrays are valid TOML values. */
export function toCodexMcpArgs(servers: ManagedMcpServers, environment: Environment): string[] {
  return Object.entries(servers).flatMap(([name, { connection }]) => {
    const fields =
      connection.type === "http"
        ? {
            url: connection.url,
            ...(connection.bearerTokenEnvVar
              ? { bearer_token_env_var: connection.bearerTokenEnvVar }
              : {}),
          }
        : { command: connection.command, args: connection.args, env_vars: connection.envVars };
    const required =
      connection.type === "http"
        ? connection.bearerTokenEnvVar
          ? [connection.bearerTokenEnvVar]
          : []
        : connection.envVars;
    for (const variable of required) requireVariable(environment, variable);
    return Object.entries(fields).flatMap(([key, value]) => [
      "-c",
      `mcp_servers.${name}.${key}=${encodeTomlValue(value)}`,
    ]);
  });
}

export const resolveManagedMcpConfig = Effect.fn("ManagedMcp.resolveConfig")(function* <A>(
  provider: string,
  build: () => A,
) {
  return yield* Effect.try({
    try: build,
    catch: (cause) =>
      new ProviderAdapterValidationError({
        provider,
        operation: "configure MCP servers",
        issue: cause instanceof Error ? cause.message : "Invalid MCP configuration.",
        cause,
      }),
  });
});
