import type { EnvironmentId } from "@t3tools/contracts";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEffect, useRef, useState } from "react";
import { Volume2Icon, VolumeXIcon } from "lucide-react";
import { useClientSettings } from "~/hooks/useSettings";
import {
  NarrationCursor,
  NarrationQueue,
  type NarrationMessage,
} from "@t3tools/client-runtime/narration";
import { getSpeechSynthesis, useNarrationVoices } from "~/narration/speech";
import { createConfiguredNarrationSpeaker } from "~/narration/kittenSpeech";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";

/** Mounted with an environment/thread key so navigation always stops narration. */
export function ThreadNarration({
  messages,
  environmentId,
  cwd,
}: {
  messages: readonly NarrationMessage[];
  environmentId: EnvironmentId;
  cwd: string;
}) {
  const summarize = useAtomCommand(serverEnvironment.summarizeNarration, { reportFailure: false });
  const settings = useClientSettings();
  const voices = useNarrationVoices();
  const [enabled, setEnabled] = useState(false);
  const session = useRef<{ cursor: NarrationCursor; queue: NarrationQueue } | null>(null);
  const available =
    settings.narrationEngine === "kitten" || (Boolean(getSpeechSynthesis()) && voices.length > 0);
  useEffect(() => () => session.current?.queue.stop(), []);
  useEffect(() => {
    const current = session.current;
    if (!current) return;
    const text = current.cursor.next(messages);
    if (text) current.queue.enqueue(text);
  }, [messages]);
  function toggle() {
    if (session.current) {
      session.current.queue.stop();
      session.current = null;
      setEnabled(false);
      return;
    }
    if (!available) {
      toastManager.add({
        type: "warning",
        title: "No speech voices available",
        description: "Install a system voice or use a browser that supports speech playback.",
      });
      return;
    }
    const queue = new NarrationQueue(
      createConfiguredNarrationSpeaker(settings),
      (message) => {
        session.current = null;
        setEnabled(false);
        toastManager.add({
          type: "error",
          title: "Narration stopped",
          description:
            message ??
            "Speech playback failed. Check your voice in Settings → General and try again.",
        });
      },
      Date.now,
      async (text) => {
        const result = await summarize({ environmentId, input: { cwd, text } });
        if (result._tag !== "Success") throw new Error("Narration summary failed");
        return result.value.text;
      },
    );
    session.current = { cursor: new NarrationCursor(messages, true), queue };
    setEnabled(true);
    // Start inside the click gesture so the browser can authorize subsequent speech.
    queue.enqueue("Narration is on.", false);
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={enabled ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={enabled}
            aria-label={enabled ? "Stop narration" : "Start narration"}
            onClick={toggle}
            className="shrink-0 [-webkit-app-region:no-drag]"
          />
        }
      >
        {enabled ? <Volume2Icon className="size-4" /> : <VolumeXIcon className="size-4" />}
        <span className="hidden sm:inline">{enabled ? "Narrating" : "Narrate"}</span>
      </TooltipTrigger>
      <TooltipPopup>
        {enabled
          ? "Stop speaking and clear pending updates"
          : available
            ? "Read short agent updates aloud · Voice options in Settings → General"
            : "No speech voices available on this device"}
      </TooltipPopup>
    </Tooltip>
  );
}
