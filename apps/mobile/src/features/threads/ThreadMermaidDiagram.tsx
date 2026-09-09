import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { CopyTextButton } from "../../components/CopyTextButton";
import MermaidDiagramDOM from "./MermaidDiagramDOM";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

export function useMermaidCodeBlockRenderer(isStreaming = false) {
  const { themeAppearance } = useAppearancePreferences();
  return useCallback(
    ({ code, language }: { code: string; language: string | null }) =>
      language?.trim().toLowerCase() === "mermaid" ? (
        <ThreadMermaidDiagram source={code} theme={themeAppearance} isStreaming={isStreaming} />
      ) : null,
    [themeAppearance, isStreaming],
  );
}

export function ThreadMermaidDiagram({
  source,
  theme,
  isStreaming,
}: {
  source: string;
  theme: "light" | "dark";
  isStreaming: boolean;
}) {
  const [showSource, setShowSource] = useState(false);
  const [failedSource, setFailedSource] = useState<string>();
  const onError = useCallback(async () => {
    setFailedSource(source);
  }, [source]);
  const failed = failedSource === source;
  return (
    <View className="my-3 overflow-hidden rounded-lg border border-border bg-subtle">
      <View className="flex-row items-center justify-between px-3 py-1">
        <Text className="text-xs text-foreground-muted">Mermaid</Text>
        <View className="flex-row items-center gap-2">
          {!isStreaming && !failed ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowSource(!showSource)}
              className="min-h-9 justify-center"
            >
              <Text className="text-xs text-foreground">
                {showSource ? "Show diagram" : "Show source"}
              </Text>
            </Pressable>
          ) : null}
          <CopyTextButton
            text={source}
            accessibilityLabel="Copy Mermaid source"
            tintColor={theme === "dark" ? "white" : "black"}
            buttonSize={32}
            iconSize={16}
          />
        </View>
      </View>
      {failed ? (
        <Text className="px-3 text-xs text-foreground-muted">
          Could not render this diagram. Showing source.
        </Text>
      ) : null}
      {isStreaming || showSource || failed ? (
        <ScrollView horizontal>
          <Text selectable className="p-3 font-mono text-sm text-foreground">
            {source}
          </Text>
        </ScrollView>
      ) : (
        <MermaidDiagramDOM
          key={`${theme}:${source}`}
          source={source}
          theme={theme}
          onError={onError}
          dom={{
            matchContents: true,
            scrollEnabled: false,
            style: { backgroundColor: "transparent" },
          }}
        />
      )}
    </View>
  );
}
