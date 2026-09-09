import type { SourceBuild, SourceUpdateStatus } from "@t3tools/contracts";
import type { ServiceUpdateRecord } from "../cloud/serviceProtocol.ts";

/** Reconnection is only a success when the durable receipt and running build agree. */
export function recoverSourceUpdate(
  status: SourceUpdateStatus,
  running: SourceBuild,
  receipt: ServiceUpdateRecord | undefined,
): SourceUpdateStatus {
  const matchingTarget =
    receipt !== undefined && status.target?.runtimeVersion === receipt.targetVersion;
  const matchingId =
    status.updateId === receipt?.id || (status.updateId === null && matchingTarget);
  if (!receipt || receipt.status === "pending" || !matchingId || !matchingTarget) {
    return status.phase === "restarting"
      ? {
          ...status,
          running,
          phase: "failed",
          restartRequested: false,
          message:
            "The previous update outcome could not be confirmed. Check the running version before retrying.",
        }
      : status;
  }
  const expected = receipt.status === "committed" ? receipt.targetVersion : receipt.fromVersion;
  if (running.runtimeVersion !== expected) {
    return {
      ...status,
      running,
      phase: "failed",
      restartRequested: false,
      message: "The running build does not match the launcher's update receipt.",
    };
  }
  return {
    ...status,
    running,
    phase: receipt.status === "committed" ? "idle" : "failed",
    restartRequested: false,
    updateId: receipt.id,
    outcome: receipt.status,
    message:
      receipt.status === "committed"
        ? `Updated to ${running.version}.`
        : `The previous version was restored: ${receipt.reason ?? "startup failed"}.`,
  };
}
