import type { SourceUpdateStatus } from "@t3tools/contracts";

export const sourceUpdateLabels: Record<SourceUpdateStatus["phase"], string> = {
  idle: "Up to date",
  checking: "Checking for updates…",
  available: "Update available",
  building: "Building update…",
  ready: "Ready to restart",
  waiting: "Waiting for active work",
  restarting: "Restarting…",
  failed: "Update needs attention",
};
