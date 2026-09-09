import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { serverEnvironment } from "~/state/server";
import { useEnvironments, useEnvironmentHttpBaseUrl } from "~/state/environments";
import { isElectron } from "~/env";
import { APP_VERSION } from "~/branding";
import { useComposerDraftStore } from "~/composerDraftStore";
import { toastManager } from "./ui/toast";
import { sourceUpdateLabels as labels } from "./sourceUpdateLabels";

function SourceUpdateNotice({
  environmentId,
  label,
  connected,
  compact,
}: {
  environmentId: EnvironmentId;
  label: string;
  connected: boolean;
  compact: boolean;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const status = config?.sourceUpdates;
  const navigate = useNavigate();
  const httpBase = useEnvironmentHttpBaseUrl(environmentId);
  const seen = useRef(new Set<string>());
  const reloadNotice = useRef<string | null>(null);
  useEffect(() => {
    if (compact || !connected || !status?.supported) return;
    const target = status.target;
    if (!target) return;
    const key = `t3-source-update:${environmentId}:${target.commit}:${status.phase === "failed" ? "failed" : (status.outcome ?? "available")}`;
    if (seen.current.has(key)) return;
    seen.current.add(key);
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      /* Notices still work when browser storage is unavailable. */
    }
    toastManager.add({
      type:
        status.phase === "failed" ? "error" : status.outcome === "committed" ? "success" : "info",
      title:
        status.phase === "failed"
          ? `${label}: update failed`
          : status.outcome === "committed"
            ? `${label} updated to ${status.running?.version}`
            : `${label}: ${target.version} is available`,
      description: status.message ?? "View the release notes and update progress.",
      actionProps: {
        children: "View changes",
        onClick: () => void navigate({ to: "/settings/updates" }),
      },
    });
  }, [compact, connected, environmentId, label, navigate, status]);
  useEffect(() => {
    if (
      compact ||
      isElectron ||
      !connected ||
      status?.outcome !== "committed" ||
      !status.running ||
      status.running.runtimeVersion === APP_VERSION ||
      !httpBase
    )
      return;
    if (new URL(httpBase).origin !== window.location.origin) return;
    const drafts = useComposerDraftStore.getState();
    const hasDrafts =
      Object.values(drafts.draftsByThreadKey).some(
        (draft) => draft.prompt || draft.images.length || draft.files.length,
      ) || Object.keys(drafts.backgroundSubmissionThreadKeys).length > 0;
    if (!hasDrafts) window.location.reload();
    else if (reloadNotice.current !== status.running.runtimeVersion) {
      reloadNotice.current = status.running.runtimeVersion;
      toastManager.add({
        type: "info",
        title: "The web app has been updated",
        description: "Finish sending or saving your drafts, then reload to use the new version.",
        actionProps: { children: "Reload app", onClick: () => window.location.reload() },
      });
    }
  }, [compact, connected, httpBase, status?.outcome, status?.running]);
  if (!compact || !status?.supported || !status.target || status.phase === "idle") return null;
  return (
    <Link
      to="/settings/updates"
      className="block truncate rounded-md border px-3 py-2 text-xs hover:bg-accent"
    >
      {label}: {labels[status.phase]} · {status.target.version}
    </Link>
  );
}

export function SourceUpdateNotifications({ compact = false }: { compact?: boolean }) {
  const { environments } = useEnvironments();
  return (
    <>
      {environments.map((environment) => (
        <SourceUpdateNotice
          key={environment.environmentId}
          environmentId={environment.environmentId}
          label={environment.label}
          connected={environment.connection.phase === "connected"}
          compact={compact}
        />
      ))}
    </>
  );
}
