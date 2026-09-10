// @effect-diagnostics nodeBuiltinImport:off - Filesystem boundary for the Node LSP client.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeURL from "node:url";
import type { TextEdit, WorkspaceEdit } from "vscode-languageserver-protocol";
import { runCommand } from "./process.ts";

export const contentHash = (text: string) =>
  NodeCrypto.createHash("sha256").update(text).digest("hex");

/** Provider-native subagents may create linked worktrees without creating a T3 thread. */
export async function resolveCodeWorkspace(
  threadRoot: string,
  requested?: string,
): Promise<string> {
  const root = await NodeFSP.realpath(threadRoot);
  if (!requested) return root;
  const candidate = await NodeFSP.realpath(NodePath.resolve(root, requested));
  if (candidate === root) return root;
  const commonDirectory = async (cwd: string) =>
    NodeFSP.realpath(
      (
        await runCommand("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
          cwd,
        })
      ).trim(),
    );
  if ((await commonDirectory(root)) !== (await commonDirectory(candidate)))
    throw new Error("The requested workspace belongs to a different repository.");
  const listing = await runCommand("git", ["worktree", "list", "--porcelain", "-z"], { cwd: root });
  for (const field of listing.split("\0")) {
    if (!field.startsWith("worktree ")) continue;
    try {
      if ((await NodeFSP.realpath(field.slice(9))) === candidate) return candidate;
    } catch {
      /* Ignore pruned worktrees. */
    }
  }
  throw new Error("Choose this thread's workspace or a registered linked worktree.");
}

/** Resolve existing paths through symlinks before granting workspace access. */
export async function workspaceFile(root: string, file: string): Promise<string> {
  const canonical = await NodeFSP.realpath(root);
  const target = await NodeFSP.realpath(
    file.startsWith("file:") ? NodeURL.fileURLToPath(file) : NodePath.resolve(root, file),
  );
  const relative = NodePath.relative(canonical, target);
  if (
    relative === ".." ||
    relative.startsWith(`..${NodePath.sep}`) ||
    NodePath.isAbsolute(relative)
  )
    throw new Error("The requested file is outside this worktree.");
  if (!(await NodeFSP.stat(target)).isFile())
    throw new Error("Select a file inside this worktree.");
  return target;
}
export async function readSource(file: string): Promise<string> {
  const stat = await NodeFSP.stat(file);
  if (stat.size > 2_000_000)
    throw new Error("This file is too large for interactive code tools (2 MB maximum).");
  return NodeFSP.readFile(file, "utf8");
}
export async function languageRoot(
  root: string,
  file: string,
  markers: readonly string[],
): Promise<string> {
  let directory = NodePath.dirname(file);
  while (directory !== root) {
    for (const marker of markers) {
      if (NodePath.basename(marker) !== marker) continue;
      try {
        await NodeFSP.access(NodePath.join(directory, marker));
        return directory;
      } catch {
        /* Continue to the parent project. */
      }
    }
    const parent = NodePath.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return root;
}
export interface EditPreview {
  readonly file: string;
  readonly before: string;
  readonly after: string;
  readonly hash: string;
}

function offset(text: string, position: { line: number; character: number }) {
  const lines = text.split("\n");
  const line = lines[position.line];
  if (
    line === undefined ||
    position.line < 0 ||
    position.character < 0 ||
    position.character > line.replace(/\r$/, "").length
  ) {
    throw new Error("The server returned an invalid edit range.");
  }
  return (
    lines.slice(0, position.line).reduce((sum, value) => sum + value.length + 1, 0) +
    position.character
  );
}
export function applyTextEdits(before: string, edits: readonly TextEdit[]): string {
  const replacements = edits
    .map((edit) => ({
      start: offset(before, edit.range.start),
      end: offset(before, edit.range.end),
      text: edit.newText,
    }))
    .sort((a, b) => b.start - a.start);
  let end = before.length;
  let after = before;
  for (const edit of replacements) {
    if (edit.end < edit.start || edit.end > end)
      throw new Error("The language server returned overlapping edits.");
    after = after.slice(0, edit.start) + edit.text + after.slice(edit.end);
    end = edit.start;
  }
  return after;
}
/** Resource operations need their own conflict handling; never silently apply only part of an edit. */
export async function previewWorkspaceEdit(
  root: string,
  edit: WorkspaceEdit,
  expected: ReadonlyMap<string, string>,
  versions: ReadonlyMap<string, number> = new Map(),
): Promise<EditPreview[]> {
  const changes = new Map<string, TextEdit[]>();
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) changes.set(uri, [...edits]);
  for (const change of edit.documentChanges ?? []) {
    if (!("textDocument" in change))
      throw new Error("This action creates, deletes, or renames files. Apply it in your editor.");
    if (
      change.textDocument.version !== null &&
      change.textDocument.version !== undefined &&
      versions.get(change.textDocument.uri) !== change.textDocument.version
    )
      throw new Error("The language server returned edits for a stale document version.");
    if (changes.has(change.textDocument.uri))
      throw new Error("This action contains duplicate document edits.");
    changes.set(change.textDocument.uri, [...change.edits]);
  }
  if (changes.size > 100)
    throw new Error("This action affects more than 100 files. Apply it in your editor.");
  const result: EditPreview[] = [];
  for (const [uri, edits] of changes) {
    const file = await workspaceFile(root, uri);
    const before = await readSource(file);
    const hash = contentHash(before);
    const previous = expected.get(file);
    if (previous !== undefined && previous !== hash)
      throw new Error(
        "Files changed while the language server was preparing this edit. Request a new preview.",
      );
    result.push({
      file: NodePath.relative(root, file),
      before,
      after: applyTextEdits(before, edits),
      hash,
    });
  }
  return result;
}
async function writeAtomic(file: string, text: string, signal?: AbortSignal) {
  const temporary = NodePath.join(
    NodePath.dirname(file),
    `.${NodePath.basename(file)}.t3-${NodeCrypto.randomUUID()}`,
  );
  const stat = await NodeFSP.stat(file);
  try {
    await NodeFSP.writeFile(temporary, text, { mode: stat.mode, ...(signal ? { signal } : {}) });
    await NodeFSP.chmod(temporary, stat.mode);
    signal?.throwIfAborted();
    await NodeFSP.rename(temporary, file);
  } finally {
    await NodeFSP.rm(temporary, { force: true });
  }
}
export async function applyWorkspacePreview(
  root: string,
  previews: readonly EditPreview[],
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const files = await Promise.all(
    previews.map(async (preview) => {
      const file = await workspaceFile(root, preview.file);
      if (contentHash(await readSource(file)) !== preview.hash)
        throw new Error("Files changed since this preview. Request the action again.");
      return file;
    }),
  );
  const written: number[] = [];
  try {
    for (let i = 0; i < previews.length; i++) {
      signal?.throwIfAborted();
      if (contentHash(await readSource(files[i]!)) !== previews[i]!.hash)
        throw new Error("A file changed during this edit. The action was stopped.");
      await writeAtomic(files[i]!, previews[i]!.after, signal);
      written.push(i);
    }
  } catch (error) {
    // Roll back only our own writes; preserve concurrent editor/agent changes.
    for (const i of written.toReversed()) {
      if (contentHash(await readSource(files[i]!)) === contentHash(previews[i]!.after))
        await writeAtomic(files[i]!, previews[i]!.before);
    }
    throw error;
  }
}
