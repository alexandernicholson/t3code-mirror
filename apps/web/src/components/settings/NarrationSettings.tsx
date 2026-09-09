import { useEffect, useRef, useState } from "react";
import { Volume2Icon } from "lucide-react";
import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { getSpeechSynthesis, useNarrationVoices } from "~/narration/speech";
import type { NarrationSpeaker } from "@t3tools/client-runtime/narration";
import { createConfiguredNarrationSpeaker } from "~/narration/kittenSpeech";
import { isKittenCached, clearKittenCache } from "~/narration/kittenCache";
import { KITTEN_VOICES } from "@t3tools/client-runtime/narration/kitten";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow, SettingsSection, SettingResetButton } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { toastManager } from "../ui/toast";

export function NarrationSettings() {
  const settings = useClientSettings();
  const update = useUpdateClientSettings();
  const voices = useNarrationVoices();
  const preview = useRef<NarrationSpeaker | null>(null);
  const [playing, setPlaying] = useState(false);
  const available =
    settings.narrationEngine === "kitten" || (Boolean(getSpeechSynthesis()) && voices.length > 0);
  const [cached, setCached] = useState(false);
  useEffect(() => {
    if (playing) return;
    void isKittenCached()
      .then(setCached)
      .catch(() => undefined);
  }, [playing]);
  const selectedVoice = voices.find((voice) => voice.voiceURI === settings.narrationVoice);
  useEffect(() => () => preview.current?.cancel(), []);
  function stopPreview() {
    preview.current?.cancel();
    preview.current = null;
    setPlaying(false);
  }
  function testVoice() {
    if (playing) {
      stopPreview();
      return;
    }
    const speaker = createConfiguredNarrationSpeaker(settings);
    preview.current = speaker;
    setPlaying(true);
    speaker.speak(
      "I’m looking for the relevant files. Then I’ll check the tests and let you know what I find.",
      () => {
        speaker.cancel();
        preview.current = null;
        setPlaying(false);
      },
      (message) => {
        stopPreview();
        toastManager.add({
          type: "error",
          title: "Could not play this voice",
          description: message ?? "Try another voice or check your device’s speech settings.",
        });
      },
    );
  }
  return (
    <SettingsSection
      id="narration"
      title="Voice narration"
      icon={<Volume2Icon className="size-4" />}
    >
      <SettingsRow
        title="Hear what’s happening"
        description="Turn on Narrate in a thread to hear short excerpts from new agent updates. Narration stops when you leave the thread."
        control={
          <Button size="sm" variant="outline" disabled={!available} onClick={testVoice}>
            <Volume2Icon className="size-4" />
            {playing ? "Stop preview" : "Preview voice"}
          </Button>
        }
      >
        {!available ? (
          <p className="text-xs text-muted-foreground">
            No speech voices are available yet. Install a system voice or use a browser that
            supports speech playback.
          </p>
        ) : null}
      </SettingsRow>
      <SettingsRow
        {...searchableSetting("narration-engine")}
        description="Kitten runs on your CPU. English voices, no GPU or speech service required."
        control={
          <Select
            value={settings.narrationEngine}
            onValueChange={(value) => {
              if (value !== "kitten" && value !== "system") return;
              stopPreview();
              void update({ narrationEngine: value });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Narration engine">
              <SelectValue>
                {settings.narrationEngine === "kitten" ? "Kitten Nano · Local" : "System voices"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end">
              <SelectItem value="kitten">Kitten Nano · Local</SelectItem>
              <SelectItem value="system">System voices</SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      {settings.narrationEngine === "kitten" ? (
        <>
          <SettingsRow
            title="Kitten voice"
            description="Eight English voices, generated entirely on this device."
            control={
              <Select
                value={settings.narrationKittenVoice}
                onValueChange={(value) => {
                  const voice = KITTEN_VOICES.find((voice) => voice === value);
                  if (!voice) return;
                  stopPreview();
                  void update({ narrationKittenVoice: voice });
                }}
              >
                <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Kitten voice">
                  <SelectValue>{settings.narrationKittenVoice}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end">
                  {KITTEN_VOICES.map((voice) => (
                    <SelectItem key={voice} value={voice}>
                      {voice}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
          <SettingsRow
            title="Downloaded model"
            description={
              cached
                ? "Kitten Nano 0.8 INT8 is stored in this browser. Ready for offline speech."
                : "About 28 MB for the model and voices. Downloads from Hugging Face on your first preview or narration."
            }
            control={
              cached ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={playing}
                  onClick={() => {
                    void clearKittenCache()
                      .then(() => setCached(false))
                      .catch(() =>
                        toastManager.add({
                          type: "error",
                          title: "Could not remove the downloaded model",
                        }),
                      );
                  }}
                >
                  Remove download
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Not downloaded</span>
              )
            }
          />
        </>
      ) : (
        <>
          <SettingsRow
            {...searchableSetting("narration-voice")}
            description="Voices come from this device and browser. Some voices use an online speech service."
            resetAction={
              settings.narrationVoice ? (
                <SettingResetButton
                  label="narration voice"
                  onClick={() => {
                    stopPreview();
                    void update({ narrationVoice: "" });
                  }}
                />
              ) : null
            }
            control={
              <Select
                value={settings.narrationVoice}
                onValueChange={(value) => {
                  if (value === null) return;
                  stopPreview();
                  void update({ narrationVoice: value });
                }}
              >
                <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Narration voice">
                  <SelectValue>
                    {selectedVoice
                      ? `${selectedVoice.name} (${selectedVoice.lang})`
                      : settings.narrationVoice
                        ? "Saved voice unavailable · default"
                        : "System default"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end">
                  <SelectItem value="">System default</SelectItem>
                  {voices.map((voice) => (
                    <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} ({voice.lang})
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        </>
      )}
      <SettingsRow
        {...searchableSetting("narration-speed")}
        description="Applied the next time you start narration. Voice preferences stay on this device."
        resetAction={
          settings.narrationRate !== 1 ? (
            <SettingResetButton
              label="narration speed"
              onClick={() => {
                stopPreview();
                void update({ narrationRate: 1 });
              }}
            />
          ) : null
        }
        control={
          <Select
            value={String(settings.narrationRate)}
            onValueChange={(value) => {
              if (!value) return;
              stopPreview();
              void update({ narrationRate: Number(value) });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Narration speed">
              <SelectValue>
                {settings.narrationRate}×{settings.narrationRate === 1 ? " · Normal" : ""}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end">
              {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                <SelectItem key={rate} value={String(rate)}>
                  {rate}×{rate === 1 ? " · Normal" : ""}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}
