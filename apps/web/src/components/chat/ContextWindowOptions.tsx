import type { SelectProviderOptionDescriptor } from "@t3tools/contracts";
import {
  contextWindowTokens,
  contextWindowValidationMessage,
  formatContextTokens,
  parseContextWindowTokens,
} from "@t3tools/shared/contextWindow";
import { getProviderOptionCurrentValue } from "@t3tools/shared/model";
import { InfoIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { MenuGroup, MenuRadioGroup, MenuRadioItem } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function ContextWindowOptions({
  descriptor,
  onChange,
}: {
  descriptor: SelectProviderOptionDescriptor;
  onChange: (value: string) => void;
}) {
  const context = descriptor.contextWindow!;
  const value = String(getProviderOptionCurrentValue(descriptor) ?? "default");
  const currentTokens = contextWindowTokens(context, value);
  const isCustom = parseContextWindowTokens(value) !== undefined;
  const [editingCustom, setEditingCustom] = useState(isCustom);
  const [draft, setDraft] = useState(String(currentTokens ?? ""));
  const [submitted, setSubmitted] = useState(false);
  const inputId = useId();
  const error = contextWindowValidationMessage(draft, context.maxTokens);
  const apply = () => {
    setSubmitted(true);
    if (!error) onChange(draft);
  };

  return (
    <MenuGroup>
      <div className="flex items-center justify-between gap-3 px-2 pt-1.5 pb-1">
        <span className="font-medium text-muted-foreground text-xs">Context Window</span>
        <Tooltip>
          <TooltipTrigger
            delay={200}
            render={
              <Button size="icon-micro" variant="ghost-muted" aria-label="Context window details">
                <InfoIcon className="size-3.5" />
              </Button>
            }
          />
          <TooltipPopup side="top" className="max-w-72">
            Default uses Codex’s shipped limit. Highest available uses the maximum Codex reports for
            this model. Changes apply on your next turn.
            {context.effectivePercent !== undefined
              ? ` Codex makes ${context.effectivePercent}% of the limit available to the conversation${currentTokens !== undefined ? ` (${formatContextTokens(Math.floor((currentTokens * context.effectivePercent) / 100))} tokens)` : ""}.`
              : ""}
          </TooltipPopup>
        </Tooltip>
      </div>
      <div className="flex justify-between gap-4 px-2 pb-1.5 text-xs text-muted-foreground">
        <span>Currently set</span>
        <span className="tabular-nums">{formatContextTokens(currentTokens)}</span>
      </div>
      <MenuRadioGroup
        value={editingCustom ? "custom" : value}
        onValueChange={(next) => {
          setEditingCustom(next === "custom");
          setSubmitted(false);
          if (next !== "custom") onChange(next);
        }}
      >
        {descriptor.options.map((option) => (
          <MenuRadioItem
            key={option.id}
            value={option.id}
            closeOnClick
            disabled={contextWindowTokens(context, option.id) === undefined}
          >
            <span className="flex w-full items-center justify-between gap-5 text-xs">
              <span>{option.label}</span>
              <span className="text-muted-foreground tabular-nums">{option.description}</span>
            </span>
          </MenuRadioItem>
        ))}
        <MenuRadioItem value="custom" closeOnClick={false}>
          Custom
        </MenuRadioItem>
      </MenuRadioGroup>
      {editingCustom ? (
        <div className="space-y-2 px-2 pt-1 pb-2">
          <label htmlFor={inputId} className="text-muted-foreground text-xs">
            Tokens
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={inputId}
              size="compact"
              inputMode="numeric"
              value={draft}
              aria-invalid={submitted && Boolean(error)}
              aria-describedby={submitted && error ? `${inputId}-error` : undefined}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") return;
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  apply();
                }
              }}
            />
            <Button size="xs" variant="outline" onClick={apply}>
              Apply
            </Button>
          </div>
          {submitted && error ? (
            <p id={`${inputId}-error`} role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </MenuGroup>
  );
}
