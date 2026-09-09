import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import {
  SourceUpdateSettings,
  SourceUpdateSettingsPatch,
  SourceUpdateStatus,
} from "./sourceUpdates.ts";

it("defaults a source service to automatic updates", () => {
  expect(Schema.decodeUnknownSync(SourceUpdateSettings)({})).toEqual({
    enabled: true,
    branch: "main",
    policy: "automatic",
  });
});

it("a branch patch does not reset an existing manual restart policy or paused checks", () => {
  const patch = Schema.decodeUnknownSync(SourceUpdateSettingsPatch)({ branch: "experiment" });
  expect(patch).toEqual({ branch: "experiment" });
  expect({ enabled: false, policy: "manual-restart", ...patch }).toEqual({
    enabled: false,
    policy: "manual-restart",
    branch: "experiment",
  });
});

it("keeps repository credentials and migration fingerprints out of the client status", () => {
  const encoded = Schema.encodeUnknownSync(Schema.fromJsonString(SourceUpdateStatus))({
    supported: true,
    running: {
      version: "0.1.0",
      runtimeVersion: `0.1.0+git.${"a".repeat(40)}`,
      commit: "a".repeat(40),
      branch: "main",
      repository: "https://private-token@example.com/fork.git",
      migrations: { "001": "fingerprint" },
    },
    deferred: false,
    restartRequested: false,
    phase: "idle",
    target: null,
    lastCheckedAt: null,
    message: null,
    updateId: null,
    outcome: null,
  });
  expect(encoded).not.toContain("private-token");
  expect(encoded).not.toContain("fingerprint");
});
