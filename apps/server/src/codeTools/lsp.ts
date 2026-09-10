// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - vscode-jsonrpc owns Node streams; this adapter owns their process and deadlines.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { Effect } from "effect";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import { codeToolEnvironment } from "./process.ts";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  CancellationTokenSource,
} from "vscode-jsonrpc/node.js";
import type {
  InitializeResult,
  PublishDiagnosticsParams,
  Diagnostic,
  DocumentDiagnosticReport,
  WorkspaceEdit,
  CodeAction,
  Command,
} from "vscode-languageserver-protocol";
import type {
  CodeDiagnostic,
  CodeToolInput,
  CodeToolResult,
  CodeServerOverride,
} from "@t3tools/contracts";
import { languageId, type LanguageServerDefinition } from "./catalog.ts";
import {
  contentHash,
  workspaceFile,
  readSource,
  languageRoot,
  previewWorkspaceEdit,
  applyWorkspacePreview,
} from "./workspace.ts";
import type { LanguageServerInstaller, ServerLaunch } from "./installer.ts";

const severities = ["error", "warning", "information", "hint"] as const;
function formatDiagnostics(
  root: string,
  file: string,
  source: string,
  diagnostics: readonly Diagnostic[],
): CodeDiagnostic[] {
  return diagnostics.slice(0, 200).map((value) => ({
    file: NodePath.relative(root, file),
    line: value.range.start.line + 1,
    character: value.range.start.character + 1,
    severity: severities[(value.severity ?? 1) - 1] ?? "error",
    source: value.source ?? source,
    code: String(value.code ?? ""),
    message: value.message.slice(0, 4_000),
  }));
}
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );

class LspSession {
  readonly worktree: string;
  readonly root: string;
  readonly server: LanguageServerDefinition;
  private readonly onClose: () => void;
  private readonly onSourceChanged: () => void;
  private readonly watchers = new Map<string, NodeFS.FSWatcher>();
  private readonly watchedFiles = new Set<string>();
  readonly child: NodeChildProcess.ChildProcessWithoutNullStreams;
  readonly connection;
  readonly documents = new Map<string, { hash: string; version: number }>();
  readonly diagnostics = new Map<string, { version: number; diagnostics: readonly Diagnostic[] }>();
  readonly listeners = new Set<() => void>();
  readonly ready: Promise<InitializeResult>;
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  closed = false;
  private stderr = "";
  private failure = "The language server stopped.";
  constructor(
    worktree: string,
    root: string,
    server: LanguageServerDefinition,
    launch: ServerLaunch,
    override: CodeServerOverride | undefined,
    onClose: () => void,
    onSourceChanged: () => void,
  ) {
    this.worktree = worktree;
    this.root = root;
    this.server = server;
    this.onClose = onClose;
    this.onSourceChanged = onSourceChanged;
    this.child = NodeChildProcess.spawn(launch.command, [...launch.args], {
      cwd: root,
      env: codeToolEnvironment(launch.env),
      stdio: "pipe",
      windowsHide: true,
      shell: launch.shell ?? false,
    });
    this.child.stderr.on("data", (bytes: Buffer) => {
      this.stderr = (this.stderr + bytes.toString()).slice(-2_000);
    });
    this.connection = createMessageConnection(
      new StreamMessageReader(this.child.stdout),
      new StreamMessageWriter(this.child.stdin),
    );
    this.child.on("error", (error) => {
      this.failure = error.message;
      this.close();
    });
    this.child.on("exit", (code, signal) => {
      if (!this.closed)
        this.failure = `${this.server.name} stopped (${code ?? signal ?? "unknown"}). ${this.stderr.trim()}`;
      this.close();
    });
    this.connection.onNotification(
      "textDocument/publishDiagnostics",
      (params: PublishDiagnosticsParams) => {
        const opened = this.documents.get(params.uri);
        if (!opened || (params.version !== undefined && params.version !== opened.version)) return;
        this.diagnostics.set(params.uri, {
          version: opened.version,
          diagnostics: params.diagnostics,
        });
        for (const notify of this.listeners) notify();
      },
    );
    this.connection.onRequest(
      "workspace/configuration",
      (params: { items: { section?: string }[] }) =>
        params.items.map((item) =>
          item.section
            ? (item.section
                .split(".")
                .reduce<unknown>(
                  (value, key) =>
                    value && typeof value === "object" ? Reflect.get(value, key) : undefined,
                  override?.settings ?? {},
                ) ?? null)
            : (override?.settings ?? {}),
        ),
    );
    this.connection.onRequest("workspace/workspaceFolders", () => [
      { uri: NodeURL.pathToFileURL(root).href, name: NodePath.basename(root) },
    ]);
    this.connection.onRequest("client/registerCapability", () => null);
    this.connection.onRequest("window/workDoneProgress/create", () => null);
    // Server-initiated writes must go through the same explicit edit application as user requests.
    this.connection.onRequest("workspace/applyEdit", () => ({
      applied: false,
      failureReason: "Return a WorkspaceEdit for preview and explicit application through T3 Code.",
    }));
    this.connection.listen();
    this.ready = this.request<InitializeResult>("initialize", {
      processId: process.pid,
      rootUri: NodeURL.pathToFileURL(root).href,
      workspaceFolders: [{ uri: NodeURL.pathToFileURL(root).href, name: NodePath.basename(root) }],
      capabilities: {
        general: { positionEncodings: ["utf-16"] },
        workspace: { configuration: true, workspaceFolders: true, applyEdit: false },
        textDocument: {
          publishDiagnostics: { versionSupport: true },
          diagnostic: {},
          codeAction: {
            codeActionLiteralSupport: {
              codeActionKind: { valueSet: ["quickfix", "refactor", "source"] },
            },
          },
        },
      },
      initializationOptions: override?.initializationOptions ?? {},
    }).then(async (result) => {
      if (result.capabilities.positionEncoding && result.capabilities.positionEncoding !== "utf-16")
        throw new Error("This language server requires an unsupported position encoding.");
      await this.connection.sendNotification("initialized", {});
      await this.connection.sendNotification("workspace/didChangeConfiguration", {
        settings: override?.settings ?? {},
      });
      return result;
    });
    void this.ready.catch(() => this.close());
  }
  async request<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (this.closed) throw new Error("The language server stopped. Retry to start a new session.");
    const cancellation = new CancellationTokenSource();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([
        this.connection.sendRequest<T>(method, params, cancellation.token),
        new Promise<never>((_, reject) => {
          abort = () => {
            cancellation.cancel();
            reject(signal?.reason ?? new Error("Code tool request cancelled."));
          };
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) abort();
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            cancellation.cancel();
            reject(new Error(`Language server timed out: ${method}`));
          }, 30_000);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      if (abort) signal?.removeEventListener("abort", abort);
      cancellation.dispose();
    }
  }
  use<T>(run: () => Promise<T>): Promise<T> {
    if (this.timer) clearTimeout(this.timer);
    const pending = this.queue.then(async () => {
      await this.ready;
      return run();
    });
    this.queue = pending
      .catch(() => undefined)
      .finally(() => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.close(), 5 * 60_000);
        this.timer.unref();
      });
    return pending;
  }
  async sync(file: string) {
    const uri = NodeURL.pathToFileURL(file).href;
    const text = await readSource(file);
    const hash = contentHash(text);
    const previous = this.documents.get(uri);
    if (previous?.hash === hash) return { uri, version: previous.version };
    const version = (previous?.version ?? 0) + 1;
    this.documents.set(uri, { hash, version });
    this.watchedFiles.add(uri);
    const directory = NodePath.dirname(file);
    if (!this.watchers.has(directory)) {
      const watcher = NodeFS.watch(directory, { persistent: false }, (event, name) => {
        if (event === "rename") void NodeFSP.access(this.worktree).catch(() => this.close());
        if (!name || this.closed) return;
        const changed = NodePath.join(directory, name.toString());
        const changedUri = NodeURL.pathToFileURL(changed).href;
        if (!this.watchedFiles.has(changedUri)) return;
        void readSource(changed)
          .then((content) => {
            if (contentHash(content) !== this.documents.get(changedUri)?.hash) {
              this.diagnostics.delete(changedUri);
              void this.use(() => this.sync(changed)).catch(() => undefined);
            }
            this.onSourceChanged();
          })
          .catch(() => {
            this.diagnostics.delete(changedUri);
            this.documents.delete(changedUri);
            if (!this.closed) {
              void this.connection
                .sendNotification("textDocument/didClose", { textDocument: { uri: changedUri } })
                .catch(() => undefined);
              this.onSourceChanged();
            }
          });
      });
      watcher.on("error", () => {
        watcher.close();
        this.watchers.delete(directory);
      });
      this.watchers.set(directory, watcher);
    }
    this.diagnostics.delete(uri);
    if (previous)
      await this.connection.sendNotification("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    else
      await this.connection.sendNotification("textDocument/didOpen", {
        textDocument: { uri, languageId: languageId(this.server, file), version, text },
      });
    await this.connection.sendNotification("textDocument/didSave", { textDocument: { uri }, text });
    await this.connection.sendNotification("workspace/didChangeWatchedFiles", {
      changes: [{ uri, type: 2 }],
    });
    return { uri, version };
  }
  async diagnose(file: string): Promise<CodeDiagnostic[]> {
    const { uri, version } = await this.sync(file);
    if ((await this.ready).capabilities.diagnosticProvider) {
      const report = await this.request<DocumentDiagnosticReport>("textDocument/diagnostic", {
        textDocument: { uri },
      });
      if (report.kind === "full")
        return formatDiagnostics(this.worktree, file, this.server.id, report.items);
    }
    const values = await new Promise<readonly Diagnostic[]>((resolve, reject) => {
      const check = () => {
        const result = this.diagnostics.get(uri);
        if (this.closed) {
          cleanup();
          reject(new Error(this.failure));
        } else if (result?.version === version) {
          cleanup();
          resolve(result.diagnostics);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            "Diagnostics have not arrived yet. Retry once the language server finishes indexing.",
          ),
        );
      }, 10_000);
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(check);
      };
      this.listeners.add(check);
      check();
    });
    return formatDiagnostics(this.worktree, file, this.server.id, values);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    this.connection.dispose();
    this.child.kill();
    for (const notify of this.listeners) notify();
    this.onClose();
  }
}

export class LanguageServerPool {
  private readonly sessions = new Map<string, LspSession>();
  private readonly installer: LanguageServerInstaller;
  private readonly changed: () => void;
  private readonly sourceChanged: (worktree: string) => void;
  constructor(
    installer: LanguageServerInstaller,
    changed: () => void,
    sourceChanged: (worktree: string) => void = () => {},
  ) {
    this.installer = installer;
    this.changed = changed;
    this.sourceChanged = sourceChanged;
  }
  count(id: string) {
    return [...this.sessions.values()].filter((value) => value.server.id === id).length;
  }
  close(serverId?: string, worktree?: string) {
    for (const session of this.sessions.values())
      if (
        (!serverId || session.server.id === serverId) &&
        (!worktree || session.worktree === worktree)
      )
        session.close();
  }
  async run(
    worktreePath: string,
    definition: LanguageServerDefinition,
    override: CodeServerOverride | undefined,
    input: CodeToolInput,
    automaticInstall: boolean,
    signal?: AbortSignal,
  ): Promise<CodeToolResult> {
    signal?.throwIfAborted();
    const worktree = await NodeFSP.realpath(worktreePath);
    const file = input.file ? await workspaceFile(worktree, input.file) : undefined;
    const root = file ? await languageRoot(worktree, file, definition.rootMarkers) : worktree;
    const key = stable([
      worktree,
      root,
      definition.id,
      definition.command,
      definition.args,
      override,
    ]);
    let session = this.sessions.get(key);
    // Running workspaces retain their installed version until idle shutdown or an explicit restart.
    if (!session) {
      let launch = await this.installer.resolve(definition, root, override?.command);
      if (!launch && automaticInstall) {
        await this.installer.install(definition);
        launch = await this.installer.resolve(definition, root, override?.command);
      }
      if (!launch)
        throw new Error(
          `${definition.name} is not installed. Install it in Settings → Tools & MCP servers → Code tools, or enable installation when needed.`,
        );
      launch = {
        ...launch,
        ...(await Effect.runPromise(
          resolveSpawnCommand(launch.command, launch.args, { env: launch.env }),
        )),
      };
      // Another request may have completed startup while this one resolved its executable.
      session = this.sessions.get(key);
      if (!session) {
        session = new LspSession(
          worktree,
          root,
          definition,
          launch,
          {
            id: definition.id,
            enabled: true,
            ...override,
            initializationOptions: {
              ...launch.initializationOptions,
              ...override?.initializationOptions,
            },
          },
          () => {
            this.sessions.delete(key);
            this.changed();
          },
          () => this.sourceChanged(worktree),
        );
        this.sessions.set(key, session);
        this.changed();
      }
    }
    const active = session;
    return active.use(async () => {
      signal?.throwIfAborted();
      const request = <T>(method: string, params: unknown) =>
        active.request<T>(method, params, signal);
      if (input.action === "capabilities" || input.action === "status")
        return {
          text: `${definition.name} is ready.`,
          diagnostics: [],
          data: (await active.ready).capabilities,
        };
      if (input.action === "diagnostics") {
        if (!file) throw new Error("Choose a file to request language-server diagnostics.");
        const hash = contentHash(await readSource(file));
        const diagnostics = await active.diagnose(file);
        if (contentHash(await readSource(file)) !== hash)
          throw new Error(
            "This file changed while it was being checked. Retry against its current contents.",
          );
        return {
          text: diagnostics.length
            ? `${diagnostics.length} diagnostic(s)`
            : "No diagnostics reported for this file.",
          diagnostics,
          data: null,
        };
      }
      if (input.action !== "symbols" && !file) throw new Error("This action requires a file.");
      if (file) await active.sync(file);
      const textDocument = { uri: file ? NodeURL.pathToFileURL(file).href : "" };
      const position = { line: (input.line ?? 1) - 1, character: (input.character ?? 1) - 1 };
      let data: unknown;
      switch (input.action) {
        case "definition":
          data = await request("textDocument/definition", { textDocument, position });
          break;
        case "references":
          data = await request("textDocument/references", {
            textDocument,
            position,
            context: { includeDeclaration: true },
          });
          break;
        case "hover":
          data = await request("textDocument/hover", { textDocument, position });
          break;
        case "symbols":
          data = await request(
            input.file ? "textDocument/documentSymbol" : "workspace/symbol",
            input.file ? { textDocument } : { query: input.query ?? "" },
          );
          break;
        case "rename":
        case "code_actions": {
          // Capture open-document hashes before the request to reject stale edits.
          const expected = new Map<string, string>();
          for (const [uri, doc] of active.documents)
            expected.set(await workspaceFile(worktree, uri), doc.hash);
          let edit: WorkspaceEdit | null | undefined;
          if (input.action === "rename") {
            if (!input.newName) throw new Error("A new symbol name is required.");
            edit = await request("textDocument/rename", {
              textDocument,
              position,
              newName: input.newName,
            });
          } else {
            const actions = await request<(CodeAction | Command)[] | null>(
              "textDocument/codeAction",
              {
                textDocument,
                range: { start: position, end: position },
                context: {
                  diagnostics: [...(active.diagnostics.get(textDocument.uri)?.diagnostics ?? [])],
                },
              },
            );
            if (input.actionIndex === undefined)
              return {
                text: "Select a code action to preview it.",
                diagnostics: [],
                data: (actions ?? []).map((action, index) => ({
                  index,
                  title: action.title,
                  disabled: "disabled" in action ? action.disabled : undefined,
                })),
              };
            let action = actions?.[input.actionIndex];
            if (!action) throw new Error("This code action is no longer available.");
            if (
              (await active.ready).capabilities.codeActionProvider &&
              "data" in action &&
              !("edit" in action)
            )
              action = await request<CodeAction>("codeAction/resolve", action);
            if ("command" in action && action.command)
              throw new Error("This action executes a server command. Apply it in your editor.");
            edit = "edit" in action ? action.edit : undefined;
          }
          if (!edit)
            return { text: "The language server returned no edits.", diagnostics: [], data: [] };
          const preview = await previewWorkspaceEdit(
            worktree,
            edit,
            expected,
            new Map([...active.documents].map(([uri, document]) => [uri, document.version])),
          );
          if (JSON.stringify(preview).length > 500_000)
            throw new Error(
              "This edit is too large for an interactive preview. Apply it in your editor.",
            );
          if (input.apply) {
            if (
              input.expectedHashes &&
              (Object.keys(input.expectedHashes).length !== preview.length ||
                preview.some((item) => input.expectedHashes![item.file] !== item.hash))
            )
              throw new Error(
                "The files changed since your preview. Preview the action again before applying it.",
              );
            signal?.throwIfAborted();
            await applyWorkspacePreview(worktree, preview, signal);
            for (const item of preview) await active.sync(await workspaceFile(worktree, item.file));
          }
          return {
            text: `${input.apply ? "Applied" : "Previewing"} changes to ${preview.length} file(s).`,
            diagnostics: [],
            data: preview,
          };
        }
      }
      if (JSON.stringify(data ?? null).length > 500_000)
        throw new Error("The result is too large. Narrow the symbol query or file selection.");
      return {
        text: data === null ? "No results." : `${input.action} results`,
        diagnostics: [],
        data: data ?? null,
      };
    });
  }
}
