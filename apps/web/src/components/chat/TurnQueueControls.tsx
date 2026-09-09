import type { MessageId, QueuedTurn, TurnDelivery, TurnQueue } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Button } from "../ui/button";

export function TurnQueueControls(props: {
  delivery: TurnDelivery;
  onDeliveryChange: (delivery: TurnDelivery) => void;
  queue: TurnQueue | undefined;
  disabled: boolean;
  onAction: (action: "cancel" | "steer" | "resume", messageId?: MessageId) => Promise<boolean>;
  onEdit: (item: QueuedTurn) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const run = async (action: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const items = props.queue?.items ?? [];
  return (
    <div className="space-y-2 px-3 pt-2 sm:px-4" data-testid="turn-queue-controls">
      <div className="flex items-center gap-2">
        <div
          className="inline-flex rounded-lg border border-border p-0.5"
          role="group"
          aria-label="Message delivery"
        >
          {(["steer", "queue"] as const).map((delivery) => (
            <Button
              key={delivery}
              size="xs"
              variant={props.delivery === delivery ? "secondary" : "ghost"}
              aria-pressed={props.delivery === delivery}
              onClick={() => props.onDeliveryChange(delivery)}
            >
              {delivery === "steer" ? "Steer" : "Queue"}
            </Button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {props.delivery === "queue" ? "After the current turn" : "Send into current work"}
        </span>
      </div>
      {items.length > 0 && (
        <details className="rounded-lg border border-border bg-muted/30" open>
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
            {props.queue?.paused ? "Queue paused" : "Next up"} · {items.length}
          </summary>
          {props.queue?.paused && (
            <Button
              size="xs"
              variant="ghost"
              disabled={busy || props.disabled}
              onClick={() => void run(() => props.onAction("resume"))}
            >
              Resume queue
            </Button>
          )}
          <ol className="max-h-40 overflow-y-auto px-3 pb-2">
            {items.map((item, index) => (
              <li key={item.messageId} className="flex items-center gap-2 py-1">
                <span className="min-w-0 flex-1 truncate text-xs">
                  {index + 1}. {item.text || "Attachment"}
                  {item.attachments.length > 0 ? ` · ${item.attachments.length} attachment(s)` : ""}
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy || props.disabled}
                  onClick={() => void run(() => props.onEdit(item))}
                >
                  Edit
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy || props.disabled}
                  onClick={() => void run(() => props.onAction("steer", item.messageId))}
                >
                  Send now
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy || props.disabled}
                  onClick={() => void run(() => props.onAction("cancel", item.messageId))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
