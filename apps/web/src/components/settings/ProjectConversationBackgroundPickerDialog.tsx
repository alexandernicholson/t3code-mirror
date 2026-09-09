import type { ProjectConversationBackground } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";

import { CONVERSATION_BACKGROUND_COLLECTIONS } from "../../conversationBackgrounds";
import { cn } from "~/lib/utils";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";

export function ProjectConversationBackgroundPickerDialog(props: {
  readonly current: ProjectConversationBackground | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (background: ProjectConversationBackground) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="w-full sm:w-[44rem]">
        <DialogHeader>
          <DialogTitle>Choose conversation background</DialogTitle>
          <DialogDescription>
            Threads in this project use the selected background.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="min-h-0">
          <ScrollArea scrollFade className="max-h-[min(34rem,72vh)]">
            <div className="space-y-6 p-0.5 pb-3">
              {CONVERSATION_BACKGROUND_COLLECTIONS.map((collection) => (
                <section key={collection.id} aria-labelledby={`background-${collection.id}`}>
                  <h3
                    id={`background-${collection.id}`}
                    className="mb-2 text-xs font-medium text-muted-foreground"
                  >
                    {collection.label}
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {collection.options.map((option) => {
                      const selected = props.current === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-label={option.label}
                          aria-pressed={selected}
                          className={cn(
                            "group relative cursor-pointer overflow-hidden rounded-xl border bg-muted text-left outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring",
                            selected
                              ? "border-primary ring-2 ring-primary/30"
                              : "border-border/70 hover:border-foreground/40",
                          )}
                          onClick={() => {
                            props.onSelect(option.id);
                            props.onOpenChange(false);
                          }}
                        >
                          <img
                            src={option.src}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="aspect-video w-full object-cover"
                          />
                          <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/55 px-2.5 py-2 text-white text-xs backdrop-blur-sm">
                            <span>{option.label}</span>
                            {selected ? <CheckIcon aria-hidden className="size-3.5" /> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </ScrollArea>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
