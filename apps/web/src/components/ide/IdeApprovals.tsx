import type { ProviderApprovalDecision, ScopedThreadRef } from "@t3tools/contracts";
import { ApprovalRequestId } from "@t3tools/contracts";
import {
  derivePendingRequests,
  type PendingApproval,
} from "@t3tools/client-runtime/pending-requests";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useCallback, useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";
import { threadEnvironment } from "~/state/threads";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";

import { ComposerPendingApprovalActions } from "../chat/ComposerPendingApprovalActions";

function approvalKindLabel(approval: PendingApproval): string {
  switch (approval.requestKind) {
    case "file-change":
      return "File change";
    case "file-read":
      return "File read";
    case "command":
      return "Command";
    case "mcp-elicitation":
      return "App access";
    default:
      return "Approval";
  }
}

/**
 * Pending provider approvals for the thread, shown inside the IDE so an
 * agent's proposed file changes can be approved where the code is visible.
 * Responding here resolves the same underlying request the chat shows.
 */
export function IdeApprovalsSection(props: {
  readonly threadRef: ScopedThreadRef;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
}) {
  const respondToApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const [respondingRequestIds, setRespondingRequestIds] = useState<
    ReadonlyArray<ApprovalRequestId>
  >([]);
  const { approvals } = derivePendingRequests(props.activities);

  const onRespondToApproval = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision) => {
      setRespondingRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      const result = await respondToApproval({
        environmentId: props.threadRef.environmentId,
        input: {
          threadId: props.threadRef.threadId,
          requestId,
          decision,
        },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to submit approval decision",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
      setRespondingRequestIds((existing) => existing.filter((id) => id !== requestId));
    },
    [props.threadRef.environmentId, props.threadRef.threadId, respondToApproval],
  );

  if (approvals.length === 0) return null;

  return (
    <section
      aria-label="Pending approvals"
      className="border-b border-border/60 bg-card/60 px-3 py-2"
    >
      <div className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {approvals.length === 1 ? "Approval needed" : `${approvals.length} approvals needed`}
      </div>
      <ul className="space-y-2">
        {approvals.map((approval) => (
          <li
            key={approval.requestId}
            className="rounded-md border border-border/70 bg-background px-2.5 py-2"
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[11px] font-medium text-foreground">
                {approvalKindLabel(approval)}
              </span>
              {approval.appName ? (
                <span className="truncate text-[11px] text-muted-foreground">
                  {approval.appName}
                </span>
              ) : null}
            </div>
            {approval.detail ? (
              <code className="mb-2 block max-h-24 overflow-auto rounded-sm bg-[var(--code-background)] px-1.5 py-1 font-mono text-[11px] whitespace-pre text-foreground/85 [scrollbar-width:thin]">
                {approval.detail}
              </code>
            ) : null}
            <div className="flex flex-wrap items-center gap-1">
              <ComposerPendingApprovalActions
                requestId={approval.requestId}
                isResponding={respondingRequestIds.includes(approval.requestId)}
                options={approval.options}
                onRespondToApproval={onRespondToApproval}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
