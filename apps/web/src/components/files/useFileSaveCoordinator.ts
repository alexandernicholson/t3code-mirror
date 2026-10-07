import { AuthFilesystemWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { createRef, useEffect, useMemo, useRef } from "react";

import { projectEnvironment } from "~/state/projects";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { FileSaveCoordinator } from "./fileSaveCoordinator";
import {
  confirmProjectFileQueryData,
  getUnsavedProjectFileQueryData,
} from "./projectFilesQueryState";

const FILE_SAVE_DEBOUNCE_MS = 500;

interface FileSaveOptions {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  onPendingChange: (relativePath: string, pending: boolean) => void;
  /**
   * Revision the writer last saw on disk. When provided, writes become
   * conflict-checked: the server rejects them with "revision_conflict" if the
   * file changed in the meantime. Callers without conflict UI should omit it.
   */
  expectedRevision?: (contents: string) => string | undefined;
  onWriteConflict?: (error: unknown) => void;
  /** Fired after the server confirms a write, with the accepted contents. */
  onSaved?: (contents: string) => void;
}

export function useFileSaveCoordinator({
  environmentId,
  cwd,
  relativePath,
  onPendingChange,
  expectedRevision,
  onWriteConflict,
  onSaved,
}: FileSaveOptions): Pick<FileSaveCoordinator, "change" | "flush"> {
  const canWriteFiles = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const writeFile = useAtomCommand(projectEnvironment.writeFile);
  // Callbacks live behind refs so an inline prop does not tear down and
  // rebuild the debounce session on every render.
  const expectedRevisionRef = useRef(expectedRevision);
  const onWriteConflictRef = useRef(onWriteConflict);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    expectedRevisionRef.current = expectedRevision;
    onWriteConflictRef.current = onWriteConflict;
    onSavedRef.current = onSaved;
  });
  const session = useMemo(() => {
    const coordinatorRef = createRef<FileSaveCoordinator>();
    return {
      change: (contents: string) => coordinatorRef.current?.change(contents),
      flush: () => coordinatorRef.current?.flush(),
      setup: () => {
        const coordinator = new FileSaveCoordinator({
          debounceMs: FILE_SAVE_DEBOUNCE_MS,
          canPersist: () => readEnvironmentScope(environmentId, AuthFilesystemWriteScope),
          onPendingChange: (pending) => onPendingChange(relativePath, pending),
          persist: (nextContents) => {
            const revision = expectedRevisionRef.current?.(nextContents);
            const request = writeFile({
              environmentId,
              input: {
                cwd,
                relativePath,
                contents: nextContents,
                ...(revision !== undefined ? { expectedRevision: revision } : {}),
              },
            });
            const onConflict = onWriteConflictRef.current;
            if (onConflict) {
              void request.then((result) => {
                if (result._tag === "Failure") onConflict(squashAtomCommandFailure(result));
              });
            }
            return request;
          },
          onConfirmed: (confirmedContents) => {
            onSavedRef.current?.(confirmedContents);
            confirmProjectFileQueryData(environmentId, cwd, relativePath, confirmedContents);
          },
        });
        coordinatorRef.current = coordinator;
        return () => {
          coordinatorRef.current = null;
          coordinator.dispose();
        };
      },
    };
  }, [cwd, environmentId, onPendingChange, relativePath, writeFile]);

  // StrictMode replays effect setup. Retired file sessions stay inert, while the
  // replay gets a fresh coordinator instead of reusing a disposed one.
  useEffect(session.setup, [session]);
  useEffect(() => {
    if (!canWriteFiles) return;
    let cancelled = false;
    // Replay must retire the first session before recovery queues a draft to flush.
    queueMicrotask(() => {
      if (cancelled) return;
      const unsaved = getUnsavedProjectFileQueryData(environmentId, cwd, relativePath);
      if (unsaved) session.change(unsaved.contents);
    });
    return () => {
      cancelled = true;
    };
  }, [canWriteFiles, cwd, environmentId, relativePath, session]);
  return session;
}
