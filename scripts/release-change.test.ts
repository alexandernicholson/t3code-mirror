// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, it } from "vite-plus/test";
import { changeRelease, checkRelease } from "./release-change.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await NodeFSP.rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-release-test-"));
  roots.push(root);
  await NodeFSP.writeFile(NodePath.join(root, "VERSION"), "0.1.0\n");
  await NodeFSP.writeFile(
    NodePath.join(root, "CHANGELOG.md"),
    "# Changelog\n\n## [0.1.0] - 2026-09-08\n\n- First release\n",
  );
  for (const dir of ["apps/server", "apps/web", "apps/desktop", "packages/contracts"]) {
    await NodeFSP.mkdir(NodePath.join(root, dir), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(root, dir, "package.json"),
      '{"name":"fixture", "version":"0.1.0"}\n',
    );
  }
  return root;
}
it("bumps packages together and preserves older release notes", async () => {
  const root = await fixture();
  expect(await changeRelease(root, "patch", "Fix updates")).toBe("0.1.1");
  expect(await checkRelease(root)).toBe("0.1.1");
  const notes = await NodeFSP.readFile(NodePath.join(root, "CHANGELOG.md"), "utf8");
  expect(notes.indexOf("Fix updates")).toBeLessThan(notes.indexOf("First release"));
});
it("rejects invalid changes before writing any version", async () => {
  const root = await fixture();
  await expect(changeRelease(root, "0.0.1", "Downgrade")).rejects.toThrow("newer");
  await expect(changeRelease(root, "patch", "")).rejects.toThrow("release note");
  expect(await checkRelease(root)).toBe("0.1.0");
});
