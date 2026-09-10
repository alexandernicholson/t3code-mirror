import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useGlobalNarration } from "./GlobalNarration";

export function ThreadNarration() {
  const narration = useGlobalNarration();
  return (
    <View className="flex-row justify-end bg-screen px-4 py-1">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={narration.enabled ? "Stop global narration" : "Start global narration"}
        accessibilityState={{ selected: narration.enabled }}
        onPress={narration.toggle}
        className="flex-row items-center gap-2 rounded-full bg-card px-3 py-2"
      >
        <SymbolView name="speaker.wave.2" size={16} tintColorClassName="accent-icon" />
        <Text className="text-sm text-foreground">
          {narration.enabled ? "Stop Narrate" : "Global Narrate"}
        </Text>
      </Pressable>
    </View>
  );
}
