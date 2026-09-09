import { describe, expect, it } from "vite-plus/test";
import { fileContentRevision } from "@t3tools/shared/fileRevision";

import {
  applyIdeServerContents,
  applyIdeUserEdit,
  applyIdeWriteAccepted,
  createIdeBuffer,
  ideBufferExpectedRevision,
  isIdeBufferDirty,
  resolveIdeConflictKeepMine,
  resolveIdeConflictUseServer,
} from "./ideBuffers";

const V1 = "line one\n";
const V2 = "line one\nline two\n";
const V3 = "line one\nagent line\n";

describe("ideBuffers", () => {
  it("starts clean and tracks user edits as dirty", () => {
    const buffer = createIdeBuffer("a.ts", V1);
    expect(isIdeBufferDirty(buffer)).toBe(false);
    const edited = applyIdeUserEdit(buffer, V2);
    expect(isIdeBufferDirty(edited)).toBe(true);
    expect(applyIdeUserEdit(edited, V2)).toBe(edited);
  });

  it("ignores a server read with the same revision", () => {
    const buffer = createIdeBuffer("a.ts", V1);
    expect(applyIdeServerContents(buffer, V1)).toBe(buffer);
  });

  it("reloads a clean buffer when the server changes", () => {
    const buffer = createIdeBuffer("a.ts", V1);
    const next = applyIdeServerContents(buffer, V2);
    expect(next.baselineContents).toBe(V2);
    expect(next.draftContents).toBe(V2);
    expect(next.conflict).toBeNull();
    expect(isIdeBufferDirty(next)).toBe(false);
  });

  it("silently adopts the server revision when both sides typed the same contents", () => {
    const buffer = applyIdeUserEdit(createIdeBuffer("a.ts", V1), V2);
    const next = applyIdeServerContents(buffer, V2);
    expect(next.conflict).toBeNull();
    expect(next.baselineRevision).toBe(fileContentRevision(V2));
    expect(isIdeBufferDirty(next)).toBe(false);
  });

  it("raises a conflict when the server diverges from a dirty draft", () => {
    const buffer = applyIdeUserEdit(createIdeBuffer("a.ts", V1), V2);
    const next = applyIdeServerContents(buffer, V3);
    expect(next.conflict).toEqual({
      serverContents: V3,
      serverRevision: fileContentRevision(V3),
    });
    expect(next.draftContents).toBe(V2);
  });

  it("does not re-raise the same conflict on a repeated server read", () => {
    const buffer = applyIdeUserEdit(createIdeBuffer("a.ts", V1), V2);
    const conflicted = applyIdeServerContents(buffer, V3);
    expect(applyIdeServerContents(conflicted, V3)).toBe(conflicted);
  });

  it("keeps the user draft but rebases the baseline when keeping mine", () => {
    const buffer = applyIdeServerContents(applyIdeUserEdit(createIdeBuffer("a.ts", V1), V2), V3);
    const resolved = resolveIdeConflictKeepMine(buffer);
    expect(resolved.conflict).toBeNull();
    expect(resolved.draftContents).toBe(V2);
    expect(resolved.baselineContents).toBe(V3);
    // The next write must target the server's revision to be accepted.
    expect(ideBufferExpectedRevision(resolved)).toBe(fileContentRevision(V3));
    expect(isIdeBufferDirty(resolved)).toBe(true);
  });

  it("discards the draft when using the server version", () => {
    const buffer = applyIdeServerContents(applyIdeUserEdit(createIdeBuffer("a.ts", V1), V2), V3);
    const resolved = resolveIdeConflictUseServer(buffer);
    expect(resolved.conflict).toBeNull();
    expect(resolved.draftContents).toBe(V3);
    expect(isIdeBufferDirty(resolved)).toBe(false);
  });

  it("adopts an accepted write as the new baseline", () => {
    const buffer = applyIdeUserEdit(createIdeBuffer("a.ts", V1), V2);
    const saved = applyIdeWriteAccepted(buffer, V2);
    expect(isIdeBufferDirty(saved)).toBe(false);
    expect(saved.baselineRevision).toBe(fileContentRevision(V2));
  });
});
