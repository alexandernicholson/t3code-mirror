import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState } from "react";
import { type EnvironmentId, type SecretApprovalInput, type ThreadId } from "@t3tools/contracts";
import { secrets } from "~/state/secrets";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { InfoTooltip } from "../ui/info-tooltip";
import { ComposerBanner } from "./ComposerBanner";

export function SecretAccessPanel({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const snapshot = useAtomValue(secrets.snapshot({ environmentId, input: {} }));
  const respond = useAtomCommand(secrets.respond);
  const revoke = useAtomCommand(secrets.revoke);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (!AsyncResult.isSuccess(snapshot)) return null;
  const request = snapshot.value.pendingReads.find((entry) => entry.threadId === threadId);
  const grants = snapshot.value.threadGrants.filter((entry) => entry.threadId === threadId);
  if (!request)
    return grants.length === 0 ? null : (
      <ComposerBanner.Root className="flex flex-wrap items-center justify-between gap-2 px-3 [--composer-banner-padding-block:--spacing(3)]">
        <p className="text-xs text-muted-foreground">
          Thread access: {grants.map((entry) => entry.key).join(", ")}
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void revoke({ environmentId, input: { threadId } }).then((result) => {
              setBusy(false);
              setError(result._tag !== "Success");
            });
          }}
        >
          Revoke thread access
        </Button>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            Could not revoke access. Try again.
          </p>
        )}
      </ComposerBanner.Root>
    );
  async function decide(decision: SecretApprovalInput["decision"]) {
    if (!request || busy) return;
    setBusy(true);
    setError(false);
    const result = await respond({
      environmentId,
      input: { requestId: request.requestId, decision },
    });
    setBusy(false);
    setError(result._tag !== "Success");
  }
  return (
    <ComposerBanner.Root
      variant="warning"
      className="space-y-2 px-3 [--composer-banner-padding-block:--spacing(3)]"
      role="region"
      aria-label="Secret access request"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">
          Allow access to <span className="break-all font-mono">{request.key}</span>?
        </p>
        <InfoTooltip label="Secret access details">
          Thread access applies to this secret until you revoke it, the secret changes, or the
          environment restarts.
        </InfoTooltip>
      </div>
      <p className="text-xs text-muted-foreground">
        {request.scope.type === "environment" ? "Environment-wide" : "Project secret"}
      </p>
      <p className="whitespace-pre-wrap break-words text-sm">{request.reason}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void decide("once")}>
          Allow once
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void decide("thread")}>
          Allow for thread
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide("deny")}>
          Deny
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          Could not respond. Try again.
        </p>
      )}
    </ComposerBanner.Root>
  );
}
