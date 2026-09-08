import { Pressable, View } from "react-native";
import type { NarrationMessage } from "@t3tools/client-runtime/narration";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { GitActionProgressOverlay } from "../threads/GitActionProgressOverlay";
import { useNarration } from "./useNarration";

export function ThreadNarration({ messages }: { messages: readonly NarrationMessage[] }) {
  const narration = useNarration(messages);
  return (
    <>
      <View className="flex-row justify-end bg-screen px-4 py-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={narration.enabled ? "Stop narration" : "Start narration"}
          accessibilityState={{ selected: narration.enabled }}
          onPress={() => narration.start()}
          className="flex-row items-center gap-2 rounded-full bg-card px-3 py-2"
        >
          <SymbolView name="speaker.wave.2" size={16} tintColorClassName="accent-icon" />
          <Text className="text-sm text-foreground">
            {narration.enabled ? "Stop narration" : "Narrate"}
          </Text>
        </Pressable>
      </View>
      {narration.progress ? (
        <GitActionProgressOverlay
          progress={{
            phase: "running",
            label:
              narration.progress.phase === "downloading"
                ? `Downloading Kitten voice · ${narration.progress.percent}%`
                : "Preparing Kitten voice…",
            description: "Saved on this device for offline narration.",
            fraction: narration.progress.percent / 100,
          }}
          onDismiss={narration.stop}
        />
      ) : null}
    </>
  );
}
