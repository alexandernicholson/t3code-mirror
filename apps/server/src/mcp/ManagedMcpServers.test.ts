import { expect, it } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS, type ManagedMcpServers, ThreadId } from "@t3tools/contracts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import {
  clearManagedMcpServers,
  readManagedMcpServers,
  setManagedMcpServers,
  toAcpMcpServers,
  toClaudeMcpServers,
  toCodexMcpArgs,
} from "./ManagedMcpServers.ts";

const servers: ManagedMcpServers = {
  docs: {
    enabled: true,
    providers: ["codex", "claudeAgent"],
    projectIds: [],
    connection: { type: "http", url: "https://example.com/mcp", bearerTokenEnvVar: "MCP_TOKEN" },
  },
  local: {
    enabled: true,
    providers: ["codex", "claudeAgent"],
    projectIds: [],
    connection: {
      type: "stdio",
      command: "/path with spaces/tool",
      args: ['say "hello"', "C:\\tools", "a\nb"],
      envVars: ["MCP_TOKEN"],
    },
  },
};
const env = { MCP_TOKEN: "test-secret" };

it("merges per-server updates and removals without retaining old connection fields", () => {
  const initial = { ...DEFAULT_SERVER_SETTINGS, managedMcpServers: servers };
  const next = applyServerSettingsPatch(initial, {
    managedMcpServers: {
      docs: {
        ...servers.docs!,
        connection: { type: "stdio", command: "node", args: [], envVars: [] },
      },
      local: null,
    },
  });
  expect(next.managedMcpServers).toEqual({
    docs: {
      ...servers.docs,
      connection: { type: "stdio", command: "node", args: [], envVars: [] },
    },
  });
  expect(
    applyServerSettingsPatch(initial, { managedMcpServers: { docs: null } }).managedMcpServers,
  ).toEqual({ local: servers.local });
});
it("resolves HTTP credentials and stdio variables into native Claude and ACP configuration", () => {
  expect(toClaudeMcpServers(servers, env)).toEqual({
    docs: {
      type: "http",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer test-secret" },
    },
    local: {
      type: "stdio",
      command: "/path with spaces/tool",
      args: ['say "hello"', "C:\\tools", "a\nb"],
      env: { MCP_TOKEN: "test-secret" },
    },
  });
  expect(toAcpMcpServers(servers, env)).toEqual([
    {
      name: "docs",
      type: "http",
      url: "https://example.com/mcp",
      headers: [{ name: "Authorization", value: "Bearer test-secret" }],
    },
    {
      name: "local",
      command: "/path with spaces/tool",
      args: ['say "hello"', "C:\\tools", "a\nb"],
      env: [{ name: "MCP_TOKEN", value: "test-secret" }],
    },
  ]);
});
it("emits valid TOML overrides without putting secrets in Codex process arguments", () => {
  const args = toCodexMcpArgs(servers, env);
  expect(args.join(" ")).not.toContain("test-secret");
  expect(args).toContain('mcp_servers.docs.bearer_token_env_var="MCP_TOKEN"');
  expect(args).toContain('mcp_servers.local.command="/path with spaces/tool"');
  expect(args).toContain('mcp_servers.local.env_vars=["MCP_TOKEN"]');
});
it("reports missing credentials without exposing values", () => {
  for (const convert of [toClaudeMcpServers, toAcpMcpServers, toCodexMcpArgs]) {
    expect(() => convert(servers, {})).toThrow("MCP_TOKEN");
  }
});
it("keeps managed servers scoped to their thread and clears them on teardown", () => {
  const one = ThreadId.make("one");
  const two = ThreadId.make("two");
  setManagedMcpServers(one, servers);
  expect(readManagedMcpServers(one)).toEqual(servers);
  expect(readManagedMcpServers(two)).toEqual({});
  clearManagedMcpServers(one);
  expect(readManagedMcpServers(one)).toEqual({});
});
