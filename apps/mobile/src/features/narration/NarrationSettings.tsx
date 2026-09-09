import type { NarrationMessage } from "@t3tools/client-runtime/narration";
import { useEffect, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { KITTEN_VOICES } from "@t3tools/client-runtime/narration/kitten";
import { AppText as Text } from "../../components/AppText";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsRow } from "../settings/components/SettingsRow";
import { GitActionProgressOverlay } from "../threads/GitActionProgressOverlay";
import { isNativeKittenCached, clearNativeKittenCache } from "./kittenSpeech";
import { useNarration } from "./useNarration";

const NO_MESSAGES: readonly NarrationMessage[] = [];
export function NarrationSettings() {
  const result = useAtomValue(mobilePreferencesAtom);
  const settings = AsyncResult.isSuccess(result) ? result.value : {};
  const update = useAtomSet(updateMobilePreferencesAtom);
  const narration = useNarration(NO_MESSAGES);
  const [cached, setCached] = useState(false);
  useEffect(() => {
    if (narration.enabled) return;
    void isNativeKittenCached()
      .then(setCached)
      .catch(() => undefined);
  }, [narration.enabled]);
  return (
    <>
      <SettingsSection title="Voice narration" card>
        <View className="gap-3 p-4">
          <Text className="text-base text-foreground">Kitten Nano · Local English voices</Text>
          <Text className="text-sm text-foreground-muted">
            Hear short agent updates while you work. Downloads about 28 MB plus pronunciation data
            on first use, then speaks offline on this device.
          </Text>
          <Text className="text-sm text-foreground-muted">Voice</Text>
          <View className="flex-row flex-wrap gap-2">
            {KITTEN_VOICES.map((voice) => (
              <Pressable
                key={voice}
                accessibilityRole="button"
                accessibilityLabel={`Narration voice ${voice}`}
                accessibilityState={{ selected: (settings.narrationVoice ?? "Jasper") === voice }}
                onPress={() => {
                  narration.stop();
                  update({ narrationVoice: voice });
                }}
                className={
                  (settings.narrationVoice ?? "Jasper") === voice
                    ? "rounded-full bg-foreground px-3 py-2"
                    : "rounded-full bg-screen px-3 py-2"
                }
              >
                <Text
                  className={
                    (settings.narrationVoice ?? "Jasper") === voice
                      ? "text-sm text-screen"
                      : "text-sm text-foreground"
                  }
                >
                  {voice}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text className="text-sm text-foreground-muted">Speaking speed</Text>
          <View className="flex-row flex-wrap gap-2">
            {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
              <Pressable
                key={rate}
                accessibilityRole="button"
                accessibilityLabel={`Narration speed ${rate}`}
                accessibilityState={{ selected: (settings.narrationRate ?? 1) === rate }}
                onPress={() => {
                  narration.stop();
                  update({ narrationRate: rate });
                }}
                className={
                  (settings.narrationRate ?? 1) === rate
                    ? "rounded-full bg-foreground px-3 py-2"
                    : "rounded-full bg-screen px-3 py-2"
                }
              >
                <Text
                  className={
                    (settings.narrationRate ?? 1) === rate
                      ? "text-sm text-screen"
                      : "text-sm text-foreground"
                  }
                >
                  {rate}×
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <SettingsRow
          icon="speaker.wave.2"
          label={narration.enabled ? "Stop preview" : "Preview voice"}
          onPress={() =>
            narration.start(
              "I’m looking for the relevant files. Then I’ll check the tests and let you know what I find.",
              true,
            )
          }
        />
        <SettingsRow
          icon="trash"
          label="Remove downloaded model"
          value={cached ? "Downloaded" : "Not downloaded"}
          disabled={!cached || narration.enabled}
          onPress={() => {
            void clearNativeKittenCache()
              .then(() => setCached(false))
              .catch(() => Alert.alert("Could not remove the downloaded model"));
          }}
        />
      </SettingsSection>
      {narration.progress ? (
        <GitActionProgressOverlay
          progress={{
            phase: "running",
            label: `Preparing Kitten voice · ${narration.progress.percent}%`,
            description: "Downloaded once, then cached on this device.",
            fraction: narration.progress.percent / 100,
          }}
          onDismiss={narration.stop}
        />
      ) : null}
    </>
  );
}
