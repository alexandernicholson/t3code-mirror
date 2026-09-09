import type { MessageId, QueuedTurn, TurnDelivery, TurnQueue } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { CornerUpRightIcon, ListPlusIcon, EllipsisIcon } from "lucide-react";
import { Menu, MenuItem, MenuPopup, MenuTrigger, MenuRadioGroup, MenuRadioItem } from "../ui/menu";
import { composerFloatingLayerProps } from "./composerEventScope";
import { Button } from "../ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";

export function TurnQueueControls(props: {
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
  if (items.length === 0) return null;
  return (
    <div className="px-3 pt-2 sm:px-4" data-testid="turn-queue-controls">
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
      <ol aria-label="Queued messages" className="max-h-40 overflow-y-auto">
        {items.map((item, index) => (
          <li
            key={item.messageId}
            className="flex min-w-0 items-center gap-2 border-b border-border/50 py-0.5"
          >
            <ListPlusIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {item.text.replace(/\s+/g, " ").trim() || "Attachment"}
              {item.attachments.length > 0 ? ` · ${item.attachments.length} attachment(s)` : ""}
            </span>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Actions for queued message ${index + 1}`}
                    disabled={busy || props.disabled}
                  />
                }
              >
                <EllipsisIcon className="size-3.5" />
              </MenuTrigger>
              <MenuPopup align="end" side="top" {...composerFloatingLayerProps}>
                <MenuItem
                  disabled={busy || props.disabled}
                  onClick={() => void run(() => props.onEdit(item))}
                >
                  Edit
                </MenuItem>
                <MenuItem
                  disabled={busy || props.disabled}
                  onClick={() => void run(() => props.onAction("steer", item.messageId))}
                >
                  Send now
                </MenuItem>
                <MenuItem
                  disabled={busy || props.disabled}
                  onClick={() => void run(() => props.onAction("cancel", item.messageId))}
                >
                  Remove
                </MenuItem>
              </MenuPopup>
            </Menu>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function TurnDeliverySelector(props: {
  delivery: TurnDelivery;
  onDeliveryChange: (delivery: TurnDelivery) => void;
}) {
  const Icon = props.delivery === "queue" ? ListPlusIcon : CornerUpRightIcon;
  const label = props.delivery === "queue" ? "Queue" : "Steer";
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label={`Message delivery: ${label}`} />
              }
            />
          }
        >
          <Icon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="top">
          {label === "Queue" ? "Queue after this turn" : "Steer current work"}
        </TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="top" {...composerFloatingLayerProps}>
        <MenuRadioGroup
          value={props.delivery}
          onValueChange={(value) => {
            if (value === "steer" || value === "queue") props.onDeliveryChange(value);
          }}
        >
          <MenuRadioItem value="steer">
            <CornerUpRightIcon className="size-4" />
            Steer
          </MenuRadioItem>
          <MenuRadioItem value="queue">
            <ListPlusIcon className="size-4" />
            Queue
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
