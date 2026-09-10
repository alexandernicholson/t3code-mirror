import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  GlobalNarrationQueue,
  narrationVoiceOrder,
  type GlobalNarrationStatus,
} from "@t3tools/client-runtime/narration/global";
import { narrationThreadKey, subscribeNarrationFeed } from "@t3tools/client-runtime/narration/feed";
import { KITTEN_VOICES } from "@t3tools/client-runtime/narration/kitten";
import { Volume2Icon, VolumeXIcon } from "lucide-react";
import { useClientSettings } from "~/hooks/useSettings";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentThreadDetails, environmentThreadShells } from "~/state/threads";
import { environmentProjects } from "~/state/projects";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { createConfiguredNarrationSpeaker } from "./kittenSpeech";
import { getSpeechSynthesis } from "./speech";
import { environmentSnapshotAtom } from "~/state/shell";
import type { NarrationSpeaker } from "@t3tools/client-runtime/narration";

const IDLE: GlobalNarrationStatus = { title: null, voice: null, pending: 0 };
const NarrationContext = createContext<{
  enabled: boolean;
  status: GlobalNarrationStatus;
  toggle: () => void;
  stop: () => void;
  previewing: boolean;
  previewVoice: () => void;
  stopPreview: () => void;
} | null>(null);

export function useGlobalNarration() {
  const value = useContext(NarrationContext);
  if (!value) throw new Error("GlobalNarrationProvider is missing");
  return value;
}

export function GlobalNarrationProvider({ children }: { children: ReactNode }) {
  const settings = useClientSettings();
  const summarize = useAtomCommand(serverEnvironment.summarizeNarration, { reportFailure: false });
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState(IDLE);
  const [previewing, setPreviewing] = useState(false);
  const preview = useRef<NarrationSpeaker | null>(null);
  const session = useRef<GlobalNarrationQueue | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const stopPreview = useCallback(() => {
    preview.current?.cancel();
    preview.current = null;
    setPreviewing(false);
  }, []);
  const previewVoice = useCallback(() => {
    if (preview.current) return stopPreview();
    if (session.current) return;
    try {
      const speaker = createConfiguredNarrationSpeaker(settings);
      preview.current = speaker;
      setPreviewing(true);
      speaker.speak(
        "I’m looking for the relevant files. Then I’ll check the tests and let you know what I find.",
        stopPreview,
        (message) => {
          stopPreview();
          toastManager.add({
            type: "error",
            title: "Could not play this voice",
            description: message ?? "Try another voice or check your device’s speech settings.",
          });
        },
      );
    } catch {
      stopPreview();
      toastManager.add({ type: "error", title: "Could not play this voice" });
    }
  }, [settings, stopPreview]);
  const stop = useCallback(() => {
    const current = session.current;
    session.current = null;
    unsubscribe.current?.();
    unsubscribe.current = null;
    current?.stop();
    setEnabled(false);
    setStatus(IDLE);
  }, []);
  useEffect(
    () => () => {
      preview.current?.cancel();
      unsubscribe.current?.();
      session.current?.stop();
      session.current = null;
    },
    [],
  );
  const toggle = useCallback(() => {
    if (session.current) return stop();
    stopPreview();
    const systemVoices = getSpeechSynthesis()?.getVoices() ?? [];
    const preferredSystemVoice =
      systemVoices.find((voice) => voice.voiceURI === settings.narrationVoice) ??
      systemVoices.find((voice) => voice.default) ??
      systemVoices[0];
    const voices =
      settings.narrationEngine === "kitten"
        ? narrationVoiceOrder(KITTEN_VOICES, settings.narrationKittenVoice)
        : narrationVoiceOrder(
            systemVoices
              .filter(
                (voice) => voice.lang.split("-")[0] === preferredSystemVoice?.lang.split("-")[0],
              )
              .map((voice) => voice.voiceURI),
            preferredSystemVoice?.voiceURI ?? "",
          );
    if (voices.length === 0) {
      toastManager.add({
        type: "warning",
        title: "No speech voices available",
        description: "Choose Kitten or install a system voice in Settings → General.",
      });
      return;
    }
    try {
      const queue = new GlobalNarrationQueue(
        createConfiguredNarrationSpeaker(settings),
        voices,
        (next) =>
          setStatus({
            ...next,
            voice: systemVoices.find((voice) => voice.voiceURI === next.voice)?.name ?? next.voice,
          }),
        (message, fatal) => {
          if (fatal) stop();
          toastManager.add({
            type: "error",
            title: fatal ? "Narration stopped" : "Narration update skipped",
            description: message,
          });
        },
      );
      session.current = queue;
      setEnabled(true);
      // Start speech on the click gesture; the engine and subscriptions outlive routes.
      queue.enqueue({ key: "", title: "Global Narrate", text: "Global narration is on." });
      if (session.current !== queue) return;
      unsubscribe.current = subscribeNarrationFeed({
        registry: appAtomRegistry,
        shells: environmentThreadShells.threadShellsAtom,
        environmentBaseline: (id) => appAtomRegistry.get(environmentSnapshotAtom(id))?.updatedAt,
        state: environmentThreadDetails.stateAtom,
        fullText: true,
        onRemove: (key) => queue.remove(key),
        onUpdate: (thread, text) => {
          const project = appAtomRegistry.get(
            environmentProjects.projectAtom({
              environmentId: thread.environmentId,
              projectId: thread.projectId,
            }),
          );
          queue.enqueue({
            key: narrationThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
            title: thread.title,
            text,
            summarize: async (text) => {
              const result = await summarize({
                environmentId: thread.environmentId,
                input: { cwd: thread.worktreePath ?? project?.workspaceRoot ?? "", text },
              });
              if (result._tag !== "Success") throw new Error("Narration summary failed");
              return result.value.text;
            },
          });
        },
      });
    } catch {
      stop();
      toastManager.add({
        type: "error",
        title: "Could not start narration",
        description: "Check your voice in Settings and try again.",
      });
    }
  }, [settings, stop, stopPreview, summarize]);
  const value = useMemo(
    () => ({ enabled, status, toggle, stop, previewing, previewVoice, stopPreview }),
    [enabled, status, toggle, stop, previewing, previewVoice, stopPreview],
  );
  return <NarrationContext value={value}>{children}</NarrationContext>;
}

export function GlobalNarrationControl({ compact = false }: { compact?: boolean }) {
  const narration = useGlobalNarration();
  return (
    <div className={compact ? "shrink-0" : "border-t border-sidebar-border p-2"}>
      <Button
        variant={narration.enabled ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={narration.enabled}
        aria-label={narration.enabled ? "Stop global narration" : "Start global narration"}
        onClick={narration.toggle}
        className="max-w-full [-webkit-app-region:no-drag]"
      >
        {narration.enabled ? (
          <Volume2Icon className="size-4" />
        ) : (
          <VolumeXIcon className="size-4" />
        )}
        <span>{narration.enabled ? "Stop Narrate" : "Global Narrate"}</span>
      </Button>
      {!compact && narration.enabled ? (
        <p className="truncate px-2 pt-1 text-xs text-muted-foreground" role="status">
          {narration.status.title
            ? `${narration.status.title} · ${narration.status.voice}`
            : "Listening for new updates"}
          {narration.status.pending > 0 ? ` · ${narration.status.pending} queued` : ""}
        </p>
      ) : null}
    </div>
  );
}
