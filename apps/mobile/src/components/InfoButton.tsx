import { Alert, Pressable } from "react-native";
import { SymbolView } from "./AppSymbol";

export function InfoButton({ label, details }: { label: string; details: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      className="min-h-11 min-w-11 items-center justify-center"
      onPress={() => Alert.alert(label, details)}
    >
      <SymbolView name="info.circle" size={18} tintColorClassName="accent-icon" />
    </Pressable>
  );
}
