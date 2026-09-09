import {
  SelectableMarkdownText as T3SelectableMarkdownText,
  type SelectableMarkdownTextProps,
} from "@t3tools/mobile-markdown-text/renderer";

import { useMermaidCodeBlockRenderer } from "../features/threads/ThreadMermaidDiagram";

import { highlightCodeSnippet } from "../features/review/shikiReviewHighlighter";

type MobileSelectableMarkdownTextProps = Omit<SelectableMarkdownTextProps, "highlightCode">;

export type {
  MarkdownFileContextMenu,
  MarkdownFileContextMenuAction,
  MarkdownImageRenderer,
  MarkdownImageRequest,
  NativeMarkdownTextStyle,
  SelectableMarkdownSkill,
} from "@t3tools/mobile-markdown-text/types";

export function hasNativeSelectableMarkdownText(): boolean {
  return true;
}

export function SelectableMarkdownText(props: MobileSelectableMarkdownTextProps) {
  const renderCodeBlock = useMermaidCodeBlockRenderer();
  return (
    <T3SelectableMarkdownText
      {...props}
      renderCodeBlock={props.renderCodeBlock ?? renderCodeBlock}
      highlightCode={highlightCodeSnippet}
    />
  );
}
