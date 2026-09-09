import { expect, it } from "vite-plus/test";
import type { SourceBuild, SourceUpdateStatus } from "@t3tools/contracts";
import { recoverSourceUpdate } from "./recovery.ts";

const running: SourceBuild = {
  version: "0.1.1",
  runtimeVersion: `0.1.1+git.${"b".repeat(40)}`,
  branch: "main",
  commit: "b".repeat(40),
  repository: "fork",
  migrations: {},
};
const status: SourceUpdateStatus = {
  deferred: false,
  restartRequested: true,
  supported: true,
  running,
  phase: "restarting",
  target: { ...running, notes: "Changes", divergent: false },
  lastCheckedAt: null,
  message: null,
  updateId: "id",
  outcome: null,
};
const receipt = {
  id: "id",
  fromVersion: `0.1.0+git.${"a".repeat(40)}`,
  targetVersion: running.runtimeVersion,
  status: "committed" as const,
  sourceUpdate: true as const,
};
it("confirms a durable commit after reconnect and retains the release notes", () => {
  expect(recoverSourceUpdate(status, running, receipt)).toMatchObject({
    phase: "idle",
    outcome: "committed",
    restartRequested: false,
    target: { notes: "Changes" },
  });
});
it("does not report success for a different receipt or a different running build", () => {
  expect(recoverSourceUpdate(status, running, { ...receipt, id: "different" }).phase).toBe(
    "failed",
  );
  expect(
    recoverSourceUpdate(status, { ...running, runtimeVersion: receipt.fromVersion }, receipt).phase,
  ).toBe("failed");
});
it("recognizes rollback and can recover an acknowledgement interrupted before its ID was saved", () => {
  expect(recoverSourceUpdate({ ...status, updateId: null }, running, receipt).outcome).toBe(
    "committed",
  );
  expect(
    recoverSourceUpdate(
      status,
      { ...running, runtimeVersion: receipt.fromVersion },
      { ...receipt, status: "rolled-back", reason: "migration-failed" },
    ),
  ).toMatchObject({
    phase: "failed",
    outcome: "rolled-back",
    message: "The previous version was restored: migration-failed.",
  });
});
