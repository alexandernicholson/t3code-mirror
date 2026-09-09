import type {
  EnvironmentId,
  OrchestrationCheckpointSummary,
  OrchestrationThreadActivity,
  ScopedThreadRef,
} from "@t3tools/contracts";
import {
  isWorkspaceImagePreviewPath,
  isWorkspaceVideoPreviewPath,
} from "@t3tools/shared/filePreview";
import { FileCode2Icon, TriangleAlertIcon, XIcon } from "lucide-react";
import { createTwoFilesPatch } from "diff";
import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { ScrollArea } from "~/components/ui/scroll-area";
import { useWorkspaceMutationRefresh } from "~/hooks/useWorkspaceMutationRefresh";
import { cn } from "~/lib/utils";
import { StyledDiffCodeView } from "~/components/diffs/StyledDiffCodeView";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { useTheme } from "~/hooks/useTheme";

import FileBrowserPanel from "../files/FileBrowserPanel";
import { resolveFileRevision, useProjectFileQuery } from "../files/projectFilesQueryState";
import { useFileSaveCoordinator } from "../files/useFileSaveCoordinator";
import { IdeApprovalsSection } from "./IdeApprovals";
import { registerIdeSaveFlush } from "./ideSaveBus";
import { IdeEditor } from "./codemirror/IdeEditor";
import {
  type IdeBuffer,
  applyIdeServerContents,
  applyIdeUserEdit,
  applyIdeWriteAccepted,
  createIdeBuffer,
  ideBufferExpectedRevision,
  isIdeBufferDirty,
  resolveIdeConflictKeepMine,
  resolveIdeConflictUseServer,
} from "./ideBuffers";

export interface IdePanelProps {
  readonly environmentId: EnvironmentId;
  /** Thread persistence key; registers the active buffer's save flush. */
  readonly threadKey: string;
  readonly cwd: string;
  readonly projectName: string;
  readonly threadRef: ScopedThreadRef;
  readonly workspaceMutationId: string | null;
  readonly checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly isAgentRunning: boolean;
}

type BufferMap = ReadonlyMap<string, IdeBuffer>;

function isConflictError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { _tag?: unknown })._tag === "ProjectWriteFileError" &&
    (error as { failure?: unknown }).failure === "revision_conflict"
  );
}

/** Diff of the user's draft against the server's version, inside a conflict. */
function ConflictDiff(props: {
  readonly path: string;
  readonly draft: string;
  readonly server: string;
}) {
  const { resolvedTheme } = useTheme();
  const fileDiff = useMemo(() => {
    const patch = createTwoFilesPatch(
      `a/${props.path}`,
      `b/${props.path}`,
      props.server,
      props.draft,
      "On disk (agent)",
      "Your edits",
    );
    return parsePatchFiles(patch).at(0)?.files.at(0) ?? null;
  }, [props.path, props.draft, props.server]);
  if (fileDiff === null) return null;
  return (
    <StyledDiffCodeView
      items={[{ id: props.path, type: "diff", fileDiff }]}
      options={{
        overflow: "scroll",
        theme: resolveDiffThemeName(resolvedTheme),
        preferredHighlighter: PREFERRED_HIGHLIGHTER,
        themeType: resolvedTheme,
      }}
      className="max-h-64 border-t border-border/60"
    />
  );
}

/**
 * One open buffer: owns the server query, the save coordinator, and the
 * CodeMirror host. All state transitions go through `onBufferChange` so the
 * panel keeps the single copy of every buffer.
 */
function IdeBufferEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
  readonly threadKey: string;
  readonly buffer: IdeBuffer | null;
  readonly workspaceMutationId: string | null;
  readonly onBufferChange: (
    path: string,
    update: (current: IdeBuffer | null) => IdeBuffer | null,
  ) => void;
  readonly onPendingChange: (path: string, pending: boolean) => void;
}) {
  const { path, buffer } = props;
  const file = useProjectFileQuery(props.environmentId, props.cwd, path);
  const [showConflictDiff, setShowConflictDiff] = useState(false);

  // The save coordinator reads the newest buffer through this ref; the
  // panel's state updates are the only writer.
  const bufferRef = useRef(buffer);
  useEffect(() => {
    bufferRef.current = buffer;
  }, [buffer]);

  const saveCoordinator = useFileSaveCoordinator({
    environmentId: props.environmentId,
    cwd: props.cwd,
    relativePath: path,
    onPendingChange: props.onPendingChange,
    expectedRevision: () => {
      const current = bufferRef.current;
      return current === null ? undefined : ideBufferExpectedRevision(current);
    },
    onWriteConflict: (error) => {
      if (!isConflictError(error)) return;
      // The refetch that follows carries the server's contents; the effect
      // below turns them into the conflict banner.
      file.refresh();
    },
    onSaved: (contents) => {
      props.onBufferChange(path, (current) =>
        current === null ? null : applyIdeWriteAccepted(current, contents),
      );
    },
  });

  // First server read creates the buffer; later reads reconcile into it.
  const onBufferChange = props.onBufferChange;
  useEffect(() => {
    const data = file.data;
    if (data === null) return;
    onBufferChange(path, (current) => {
      const revision = resolveFileRevision(data) ?? undefined;
      return current === null
        ? createIdeBuffer(path, data.contents, revision)
        : applyIdeServerContents(current, data.contents, revision);
    });
  }, [file.data, path, onBufferChange]);

  // The visible buffer owns the thread's ide.save flush while mounted.
  useEffect(
    () => registerIdeSaveFlush(props.threadKey, () => saveCoordinator.flush()),
    [props.threadKey, saveCoordinator],
  );

  // Agent activity invalidates the read so external edits flow in.
  useWorkspaceMutationRefresh({
    mutationId: props.workspaceMutationId,
    resourceKey: `ide:${props.environmentId}:${props.cwd}:${path}`,
    refresh: file.refresh,
  });

  if (file.error !== null) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        {file.error}
      </div>
    );
  }
  if (buffer === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Spinner className="size-4" />
      </div>
    );
  }
  if (file.data?.truncated === true) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        This file is too large to edit in the browser.
      </div>
    );
  }

  const conflict = buffer.conflict;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {conflict !== null ? (
        <div className="border-b border-warning/40 bg-warning-surface px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <TriangleAlertIcon className="size-3.5 shrink-0 text-warning" />
            <span className="min-w-0 flex-1 text-xs text-foreground">
              The agent changed this file while you were editing. Your edits are unsaved.
            </span>
            <Button
              size="micro"
              variant="ghost-muted"
              onClick={() => setShowConflictDiff((show) => !show)}
            >
              {showConflictDiff ? "Hide diff" : "Compare"}
            </Button>
            <Button
              size="micro"
              variant="ghost-muted"
              onClick={() =>
                props.onBufferChange(path, (current) =>
                  current === null ? null : resolveIdeConflictUseServer(current),
                )
              }
            >
              Use agent's
            </Button>
            <Button
              size="micro"
              variant="outline"
              onClick={() => {
                const next = resolveIdeConflictKeepMine(buffer);
                props.onBufferChange(path, () => next);
                // Rewrite immediately against the server's revision so the
                // user's version wins and the file is saved.
                saveCoordinator.change(next.draftContents);
              }}
            >
              Keep mine
            </Button>
          </div>
          {showConflictDiff ? (
            <ConflictDiff
              path={path}
              draft={buffer.draftContents}
              server={conflict.serverContents}
            />
          ) : null}
        </div>
      ) : null}
      <IdeEditor
        bufferKey={`${props.environmentId}:${props.cwd}:${path}`}
        path={path}
        initialContents={buffer.draftContents}
        contents={buffer.draftContents}
        readOnly={false}
        onUserEdit={(contents) => {
          props.onBufferChange(path, (current) =>
            current === null ? null : applyIdeUserEdit(current, contents),
          );
          saveCoordinator.change(contents);
        }}
      />
    </div>
  );
}

/**
 * The in-browser IDE: a CodeMirror editor per open buffer, linked to the
 * thread's canonical stream. Agent activity refreshes open buffers; a dirty
 * buffer diverged from disk raises a conflict instead of overwriting.
 */
export default function IdePanel(props: IdePanelProps) {
  const [buffers, setBuffers] = useState<BufferMap>(() => new Map());
  const [openPaths, setOpenPaths] = useState<ReadonlyArray<string>>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [pendingPaths, setPendingPaths] = useState<ReadonlySet<string>>(() => new Set());

  const onBufferChange = useCallback(
    (path: string, update: (current: IdeBuffer | null) => IdeBuffer | null) => {
      setBuffers((current) => {
        const updated = update(current.get(path) ?? null);
        if (updated === null || updated === current.get(path)) return current;
        const next = new Map(current);
        next.set(path, updated);
        return next;
      });
    },
    [],
  );

  const openFile = useCallback((path: string) => {
    setOpenPaths((current) => (current.includes(path) ? current : [...current, path]));
    setActivePath(path);
  }, []);

  const closeFile = useCallback(
    (path: string) => {
      setOpenPaths((current) => current.filter((openPath) => openPath !== path));
      setBuffers((current) => {
        const next = new Map(current);
        next.delete(path);
        return next;
      });
      setActivePath((current) =>
        current === path ? (openPaths.findLast((openPath) => openPath !== path) ?? null) : current,
      );
    },
    [openPaths],
  );

  const onPendingChange = useCallback((path: string, pending: boolean) => {
    setPendingPaths((current) => {
      const next = new Set(current);
      if (pending) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }, []);

  const changedFiles = useMemo(() => props.checkpoints.at(-1)?.files ?? [], [props.checkpoints]);

  const activeBuffer = activePath === null ? null : (buffers.get(activePath) ?? null);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-ide-panel="">
      <IdeApprovalsSection threadRef={props.threadRef} activities={props.activities} />
      {openPaths.length > 0 ? (
        <div
          role="tablist"
          aria-label="Open files"
          className="flex shrink-0 items-stretch gap-0 overflow-x-auto border-b border-border/60 [scrollbar-width:thin]"
        >
          {openPaths.map((path) => {
            const buffer = buffers.get(path);
            const dirty = buffer !== undefined && isIdeBufferDirty(buffer);
            const conflicted = buffer?.conflict != null;
            const name = path.split("/").at(-1) ?? path;
            return (
              <div
                key={path}
                role="tab"
                aria-selected={activePath === path}
                className={cn(
                  "group flex shrink-0 cursor-pointer items-center gap-1 border-r border-border/50 px-2.5 py-1 text-xs",
                  activePath === path
                    ? "bg-[var(--code-background)] text-foreground"
                    : "text-muted-foreground hover:bg-muted/60",
                )}
                onClick={() => setActivePath(path)}
              >
                <span className="max-w-40 truncate">{name}</span>
                {conflicted ? (
                  <TriangleAlertIcon
                    aria-label="Conflict"
                    className="size-3 shrink-0 text-warning"
                  />
                ) : dirty ? (
                  <span
                    aria-label={pendingPaths.has(path) ? "Saving" : "Unsaved changes"}
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      pendingPaths.has(path) ? "animate-pulse bg-primary" : "bg-primary",
                    )}
                  />
                ) : null}
                <button
                  type="button"
                  aria-label={`Close ${name}`}
                  className="hidden size-4 items-center justify-center rounded-sm text-muted-foreground group-hover:flex hover:bg-muted hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeFile(path);
                  }}
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {activePath === null ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <FileCode2Icon className="size-6 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">
                Pick a file on the right to start editing.
              </p>
              <p className="max-w-72 text-xs text-muted-foreground/80">
                Files the agent changes are refreshed automatically; if you are editing the same
                file, you choose whose version wins.
              </p>
            </div>
          ) : (
            <IdeBufferEditor
              key={activePath}
              environmentId={props.environmentId}
              cwd={props.cwd}
              path={activePath}
              threadKey={props.threadKey}
              buffer={activeBuffer}
              workspaceMutationId={props.workspaceMutationId}
              onBufferChange={onBufferChange}
              onPendingChange={onPendingChange}
            />
          )}
        </div>
        <aside className="flex min-h-0 w-64 shrink-0 flex-col border-l border-border/60 bg-background">
          {changedFiles.length > 0 ? (
            <div className="shrink-0 border-b border-border/60 px-2.5 py-1.5">
              <div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Changed by agent
              </div>
              <ScrollArea className="max-h-32">
                <ul className="space-y-0.5">
                  {changedFiles.map((file) => (
                    <li key={file.path}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-xs text-foreground/90 hover:bg-muted"
                        onClick={() => openFile(file.path)}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                          {file.path}
                        </span>
                        <span className="shrink-0 text-[10px] text-success">+{file.additions}</span>
                        <span className="shrink-0 text-[10px] text-destructive">
                          -{file.deletions}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          ) : null}
          <FileBrowserPanel
            key={`${props.environmentId}:${props.cwd}`}
            environmentId={props.environmentId}
            cwd={props.cwd}
            projectName={props.projectName}
            selectedPath={activePath}
            selectedPathRevealId={0}
            onOpenFile={(path) => {
              if (isWorkspaceImagePreviewPath(path) || isWorkspaceVideoPreviewPath(path)) return;
              openFile(path);
            }}
            workspaceMutationId={props.workspaceMutationId}
          />
        </aside>
      </div>
      <footer className="flex h-6 shrink-0 items-center gap-2 border-t border-border/60 px-2.5 text-[10px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate font-mono">{activePath ?? props.projectName}</span>
        {activeBuffer !== null && isIdeBufferDirty(activeBuffer) ? (
          <span>{pendingPaths.has(activePath ?? "") ? "Saving…" : "Unsaved changes"}</span>
        ) : activeBuffer !== null ? (
          <span>Saved</span>
        ) : null}
        <span>{props.isAgentRunning ? "Agent running" : "Agent idle"}</span>
      </footer>
    </div>
  );
}
