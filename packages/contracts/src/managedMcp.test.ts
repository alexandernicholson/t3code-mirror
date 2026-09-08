import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { ProjectId } from "./baseSchemas.ts";
import { ManagedMcpServer, selectManagedMcpServers } from "./managedMcp.ts";
import { ServerSettings, ServerSettingsPatch } from "./settings.ts";

const decodeSettings = Schema.decodeUnknownSync(ServerSettings);
const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const decodeServer = Schema.decodeUnknownSync(ManagedMcpServer);
const projectId = ProjectId.make("project-one");
const server: ManagedMcpServer = {
  enabled: true,
  connection: { type: "http", url: "https://example.com/mcp" },
  providers: ["codex", "claudeAgent"],
  projectIds: [],
};

describe("managed MCP settings", () => {
  it("defaults to no custom servers and accepts explicit removal", () => {
    expect(decodeSettings({}).managedMcpServers).toEqual({});
    expect(decodePatch({ managedMcpServers: { docs: null } }).managedMcpServers).toEqual({
      docs: null,
    });
  });
  it("rejects invalid connections and empty or unsupported provider scopes", () => {
    for (const connection of [
      { type: "http", url: "file:///tmp/tool" },
      { type: "http", url: "https://user:secret@example.com/mcp" },
      { type: "http", url: "https://example.com/mcp", bearerTokenEnvVar: "not a variable" },
      { type: "stdio", command: " ", args: [], envVars: [] },
    ])
      expect(() => decodeServer({ ...server, connection })).toThrow();
    for (const providers of [[], ["opencode"]])
      expect(() => decodeServer({ ...server, providers })).toThrow();
  });
  it("rejects reserved and unsafe server names at the wire boundary", () => {
    for (const name of ["t3-code", "bad.name", 'bad"name', "123", "__proto__"]) {
      expect(() => decodePatch({ managedMcpServers: { [name]: server } })).toThrow();
    }
  });
  it("filters disabled servers, providers and project scopes, including unknown projects", () => {
    const servers = {
      global: server,
      scoped: { ...server, projectIds: [projectId] },
      disabled: { ...server, enabled: false },
    };
    expect(Object.keys(selectManagedMcpServers(servers, "codex", projectId))).toEqual([
      "global",
      "scoped",
    ]);
    expect(Object.keys(selectManagedMcpServers(servers, "codex", undefined))).toEqual(["global"]);
    expect(Object.keys(selectManagedMcpServers(servers, "codex", ProjectId.make("other")))).toEqual(
      ["global"],
    );
    expect(selectManagedMcpServers(servers, "grok", projectId)).toEqual({});
    expect(selectManagedMcpServers(servers, "opencode", projectId)).toEqual({});
  });
});
