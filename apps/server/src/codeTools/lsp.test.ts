// @effect-diagnostics nodeBuiltinImport:off - Integration tests exercise a real child process and isolated files.
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { LanguageServerInstaller } from "./installer.ts";
import { LanguageServerPool } from "./lsp.ts";
import type { LanguageServerDefinition } from "./catalog.ts";
import {
  applyTextEdits,
  applyWorkspacePreview,
  contentHash,
  previewWorkspaceEdit,
  workspaceFile,
  resolveCodeWorkspace,
} from "./workspace.ts";
import { runCommand } from "./process.ts";

const fixture = String.raw`
const docs = new Map(); let root; let buffer = Buffer.alloc(0);
function send(value) { const body = JSON.stringify(value); process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body); }
function handle(message) {
  const p = message.params || {};
  if (message.method === 'textDocument/didOpen') docs.set(p.textDocument.uri, p.textDocument.text);
  if (message.method === 'textDocument/didChange') docs.set(p.textDocument.uri, p.contentChanges[0].text);
  if (message.id === undefined) return;
  if (message.method === 'textDocument/rename' && p.newName === 'deferred') { require('node:fs').writeFileSync(require('node:path').join(process.cwd(), '.rename-started'), 'ready'); return; }
  let result = null;
  if (message.method === 'initialize') { root = p.rootUri; result = { capabilities: { diagnosticProvider: {}, renameProvider: true, definitionProvider: true, codeActionProvider: true } }; }
  if (message.method === 'textDocument/diagnostic') result = { kind: 'full', items: (docs.get(p.textDocument.uri) || '').includes('broken') ? [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }, severity: 1, source: 'fixture', code: 'invalid', message: 'Broken fixture in ' + root }] : [] };
  if (message.method === 'textDocument/definition') result = [{ uri: p.textDocument.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } } }];
  if (message.method === 'textDocument/rename') result = { changes: { [p.textDocument.uri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }, newText: p.newName }] } };
  if (message.method === 'textDocument/codeAction') result = [{ title: 'Unsafe command', command: 'arbitrary-command' }];
  send({ jsonrpc: '2.0', id: message.id, result });
}
process.stdin.on('data', (bytes) => { buffer = Buffer.concat([buffer, bytes]); for (;;) { const boundary = buffer.indexOf('\r\n\r\n'); if (boundary < 0) return; const header = buffer.subarray(0, boundary).toString(); const length = Number(header.split(':')[1].trim()); if (buffer.length < boundary + 4 + length) return; const body = buffer.subarray(boundary + 4, boundary + 4 + length); buffer = buffer.subarray(boundary + 4 + length); handle(JSON.parse(body.toString())); } });
`;

describe("language-server workspaces", () => {
  let root: string;
  let installer: LanguageServerInstaller;
  let pool: LanguageServerPool;
  let server: LanguageServerDefinition;
  const override = { id: "fixture", enabled: true, command: process.execPath };
  beforeEach(async () => {
    root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-lsp-test-"));
    const executable = NodePath.join(root, "fixture.cjs");
    await NodeFSP.writeFile(executable, fixture);
    installer = new LanguageServerInstaller(NodePath.join(root, "tools"), () => {});
    pool = new LanguageServerPool(installer, () => {});
    server = {
      id: "fixture",
      name: "Fixture",
      command: process.execPath,
      args: [executable],
      languages: ["typescript"],
      extensions: [".ts"],
      rootMarkers: [],
    };
  });
  afterEach(async () => {
    pool.close();
    await installer.close();
    await NodeFSP.rm(root, { recursive: true, force: true });
  });
  it("isolates concurrent worktrees and refreshes diagnostics after edits", async () => {
    const a = NodePath.join(root, "a");
    const b = NodePath.join(root, "b");
    await Promise.all([NodeFSP.mkdir(a), NodeFSP.mkdir(b)]);
    await NodeFSP.writeFile(NodePath.join(a, "file.ts"), "broken");
    await NodeFSP.writeFile(NodePath.join(b, "file.ts"), "valid!");
    const [first, second] = await Promise.all([
      pool.run(a, server, override, { action: "diagnostics", file: "file.ts" }, false),
      pool.run(b, server, override, { action: "diagnostics", file: "file.ts" }, false),
    ]);
    expect(first.diagnostics).toHaveLength(1);
    expect(second.diagnostics).toHaveLength(0);
    expect(pool.count("fixture")).toBe(2);
    await NodeFSP.writeFile(NodePath.join(a, "file.ts"), "fixed!");
    expect(
      (await pool.run(a, server, override, { action: "diagnostics", file: "file.ts" }, false))
        .diagnostics,
    ).toEqual([]);
    pool.close(undefined, a);
    expect(pool.count("fixture")).toBe(1);
  });
  it("previews renames and rejects application after the file changes", async () => {
    const file = NodePath.join(root, "file.ts");
    await NodeFSP.writeFile(file, "symbol = 1;\n");
    const request = { action: "rename" as const, file: "file.ts", newName: "renamed" };
    const preview = await pool.run(root, server, override, request, false);
    expect(await NodeFSP.readFile(file, "utf8")).toBe("symbol = 1;\n");
    expect(preview.text).toContain("Previewing");
    const hashes = { "file.ts": contentHash("symbol = 1;\n") };
    await NodeFSP.writeFile(file, "symbol = 2;\n");
    await expect(
      pool.run(root, server, override, { ...request, apply: true, expectedHashes: hashes }, false),
    ).rejects.toThrow("changed since your preview");
    expect(await NodeFSP.readFile(file, "utf8")).toBe("symbol = 2;\n");
    await pool.run(
      root,
      server,
      override,
      { ...request, apply: true, expectedHashes: { "file.ts": contentHash("symbol = 2;\n") } },
      false,
    );
    expect(await NodeFSP.readFile(file, "utf8")).toBe("renamed = 2;\n");
  });
  it("does not execute command-bearing code actions", async () => {
    await NodeFSP.writeFile(NodePath.join(root, "file.ts"), "symbol");
    await expect(
      pool.run(
        root,
        server,
        override,
        { action: "code_actions", file: "file.ts", actionIndex: 0, apply: true },
        false,
      ),
    ).rejects.toThrow("executes a server command");
  });
  it("rejects symlinks outside the workspace and unsupported resource edits", async () => {
    const workspace = NodePath.join(root, "workspace");
    await NodeFSP.mkdir(workspace);
    const outside = NodePath.join(root, "outside.ts");
    await NodeFSP.writeFile(outside, "external");
    await NodeFSP.symlink(outside, NodePath.join(workspace, "link.ts"));
    await expect(workspaceFile(workspace, "link.ts")).rejects.toThrow("outside this worktree");
    await expect(
      previewWorkspaceEdit(
        workspace,
        { documentChanges: [{ kind: "delete", uri: "file:///outside" }] },
        new Map(),
      ),
    ).rejects.toThrow("creates, deletes, or renames");
  });
  it("preflights all files before writing an edit", async () => {
    await NodeFSP.writeFile(NodePath.join(root, "a.ts"), "before");
    await NodeFSP.writeFile(NodePath.join(root, "b.ts"), "changed");
    await expect(
      applyWorkspacePreview(root, [
        { file: "a.ts", before: "before", after: "after", hash: contentHash("before") },
        { file: "b.ts", before: "before", after: "after", hash: contentHash("before") },
      ]),
    ).rejects.toThrow("changed since this preview");
    expect(await NodeFSP.readFile(NodePath.join(root, "a.ts"), "utf8")).toBe("before");
  });
  it("uses UTF-16 offsets and correctly edits empty lines", () => {
    expect(
      applyTextEdits("😀x\n\ny", [
        {
          range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } },
          newText: "z",
        },
        {
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
          newText: "blank",
        },
      ]),
    ).toBe("😀z\nblank\ny");
  });
  it("cancels an outstanding rename before it can write files", async () => {
    const file = NodePath.join(root, "file.ts");
    await NodeFSP.writeFile(file, "symbol = 1;\n");
    const started = Promise.withResolvers<void>();
    const watcher = NodeFS.watch(root, (_event, name) => {
      if (name?.toString() === ".rename-started") started.resolve();
    });
    const controller = new AbortController();
    try {
      const pending = pool.run(
        root,
        server,
        override,
        { action: "rename", file: "file.ts", newName: "deferred", apply: true },
        false,
        controller.signal,
      );
      await started.promise;
      controller.abort(new Error("Cancelled by the user"));
      await expect(pending).rejects.toThrow("Cancelled by the user");
      expect(await NodeFSP.readFile(file, "utf8")).toBe("symbol = 1;\n");
    } finally {
      watcher.close();
    }
  });
  it("accepts registered subagent worktrees and rejects other repositories", async () => {
    const repo = NodePath.join(root, "repo");
    const child = NodePath.join(root, "worker checkout");
    const unrelated = NodePath.join(root, "unrelated");
    await NodeFSP.mkdir(repo);
    await NodeFSP.mkdir(unrelated);
    await runCommand("git", ["init", "--initial-branch=main"], { cwd: repo });
    await runCommand(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--allow-empty",
        "-m",
        "Initial",
      ],
      { cwd: repo },
    );
    await runCommand("git", ["worktree", "add", "-b", "worker", child], { cwd: repo });
    expect(await resolveCodeWorkspace(repo, child)).toBe(await NodeFSP.realpath(child));
    await runCommand("git", ["init", "--initial-branch=main"], { cwd: unrelated });
    await expect(resolveCodeWorkspace(repo, unrelated)).rejects.toThrow("different repository");
    const subdirectory = NodePath.join(repo, "src");
    await NodeFSP.mkdir(subdirectory);
    await expect(resolveCodeWorkspace(repo, subdirectory)).rejects.toThrow(
      "registered linked worktree",
    );
  });
  it("notifies the host when an external editor changes an opened file", async () => {
    const file = NodePath.join(root, "file.ts");
    await NodeFSP.writeFile(file, "valid!");
    const changed = Promise.withResolvers<string>();
    pool.close();
    pool = new LanguageServerPool(installer, () => {}, changed.resolve);
    await pool.run(root, server, override, { action: "diagnostics", file: "file.ts" }, false);
    await NodeFSP.writeFile(file, "broken");
    expect(await changed.promise).toBe(root);
    expect(
      (await pool.run(root, server, override, { action: "diagnostics", file: "file.ts" }, false))
        .diagnostics,
    ).toHaveLength(1);
  });
});
