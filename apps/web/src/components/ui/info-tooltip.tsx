import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./tooltip";

export function InfoTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={200}
        render={
          <Button type="button" size="icon-micro" variant="ghost-muted" aria-label={label}>
            <InfoIcon className="size-3.5" />
          </Button>
        }
      />
      <TooltipPopup side="top" className="max-w-72">
        {children}
      </TooltipPopup>
    </Tooltip>
  );
}
