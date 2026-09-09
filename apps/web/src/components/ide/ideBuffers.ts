import { fileContentRevision } from "@t3tools/shared/fileRevision";

/**
 * One open document in the IDE. `baseline*` is the last server-confirmed
 * state; `draftContents` is what the editor shows. A conflict means the
 * server moved while the buffer was dirty and neither side wins silently.
 */
export interface IdeBuffer {
  readonly path: string;
  readonly baselineContents: string;
  readonly baselineRevision: string;
  readonly draftContents: string;
  readonly conflict: {
    readonly serverContents: string;
    readonly serverRevision: string;
  } | null;
}

export function createIdeBuffer(path: string, contents: string, revision?: string): IdeBuffer {
  return {
    path,
    baselineContents: contents,
    baselineRevision: revision ?? fileContentRevision(contents),
    draftContents: contents,
    conflict: null,
  };
}

export function isIdeBufferDirty(buffer: IdeBuffer): boolean {
  return buffer.draftContents !== buffer.baselineContents;
}

/** Revision the next write should carry, for the server's conflict check. */
export function ideBufferExpectedRevision(buffer: IdeBuffer): string {
  return buffer.conflict?.serverRevision ?? buffer.baselineRevision;
}

export function applyIdeUserEdit(buffer: IdeBuffer, contents: string): IdeBuffer {
  if (buffer.draftContents === contents) return buffer;
  return { ...buffer, draftContents: contents };
}

/**
 * Reconciles a fresh server read into the buffer. Order of cases:
 * same revision → no-op; clean buffer → reload; dirty but identical drafts →
 * silently adopt the server revision; dirty and diverged → conflict.
 */
export function applyIdeServerContents(
  buffer: IdeBuffer,
  serverContents: string,
  serverRevision?: string,
): IdeBuffer {
  const revision = serverRevision ?? fileContentRevision(serverContents);
  if (revision === buffer.baselineRevision) {
    return buffer;
  }
  if (buffer.conflict !== null && buffer.conflict.serverRevision === revision) {
    return buffer;
  }
  if (!isIdeBufferDirty(buffer)) {
    return {
      ...buffer,
      baselineContents: serverContents,
      baselineRevision: revision,
      draftContents: serverContents,
      conflict: null,
    };
  }
  if (serverContents === buffer.draftContents) {
    // The server now holds what the user already typed (e.g. the agent made
    // the same edit): adopt its revision so the next write is accepted.
    return {
      ...buffer,
      baselineContents: serverContents,
      baselineRevision: revision,
      conflict: null,
    };
  }
  return {
    ...buffer,
    conflict: { serverContents, serverRevision: revision },
  };
}

/** The server accepted the write; adopt it as the new baseline. */
export function applyIdeWriteAccepted(
  buffer: IdeBuffer,
  writtenContents: string,
  revision?: string,
): IdeBuffer {
  return {
    ...buffer,
    baselineContents: writtenContents,
    baselineRevision: revision ?? fileContentRevision(writtenContents),
    draftContents: writtenContents,
    conflict: null,
  };
}

/** Keep the user's draft; the server's version becomes the new baseline. */
export function resolveIdeConflictKeepMine(buffer: IdeBuffer): IdeBuffer {
  if (buffer.conflict === null) return buffer;
  return {
    ...buffer,
    baselineContents: buffer.conflict.serverContents,
    baselineRevision: buffer.conflict.serverRevision,
    conflict: null,
  };
}

/** Discard the user's draft and take the server's version. */
export function resolveIdeConflictUseServer(buffer: IdeBuffer): IdeBuffer {
  if (buffer.conflict === null) return buffer;
  return {
    ...buffer,
    baselineContents: buffer.conflict.serverContents,
    baselineRevision: buffer.conflict.serverRevision,
    draftContents: buffer.conflict.serverContents,
    conflict: null,
  };
}
