import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * The IDE editor wears the same syntax palette as the diff and file-preview
 * surfaces: both pierre themes are TextMate theme JSON, and the token colors
 * below are read out of them at runtime so the editor can never drift from
 * what chat code blocks render.
 */

interface TextMateTokenColor {
  readonly scope?: string | ReadonlyArray<string>;
  readonly settings?: { readonly foreground?: string; readonly fontStyle?: string };
}

interface TextMateTheme {
  readonly colors?: Readonly<Record<string, string>>;
  readonly tokenColors: ReadonlyArray<TextMateTokenColor>;
}

function scopeColor(theme: TextMateTheme, candidates: ReadonlyArray<string>): string | undefined {
  for (const entry of theme.tokenColors) {
    if (entry.scope === undefined) continue;
    const scopes = Array.isArray(entry.scope) ? entry.scope : [entry.scope];
    if (scopes.some((scope) => candidates.includes(scope))) {
      return entry.settings?.foreground;
    }
  }
  return undefined;
}

/** TextMate scopes tried per lezer tag, first hit wins. */
const SYNTAX_SCOPE_CANDIDATES = {
  comment: ["comment"],
  string: ["string", "string.quoted"],
  number: ["constant.numeric"],
  boolean: ["constant.language.boolean", "constant.language"],
  constant: ["constant"],
  escape: ["constant.character.escape", "constant"],
  keyword: ["keyword"],
  operator: ["keyword.operator"],
  variable: ["variable", "identifier"],
  self: ["variable.language"],
  function: ["support.function", "entity.name.function"],
  type: ["support.type", "entity.name.type"],
  namespace: ["entity.name.namespace", "entity.name.type.namespace"],
  property: ["support.type.property-name", "meta.object-literal.key", "variable"],
  attribute: ["entity.other.attribute-name"],
  tag: ["entity.name.tag"],
  regexp: ["string.regexp"],
  punctuation: ["punctuation"],
  heading: ["markup.heading", "entity.name.section"],
  link: ["markup.underline.link", "support.function"],
  quote: ["markup.quote", "comment"],
  monospace: ["markup.inline.raw", "markup.fenced_code", "string"],
} as const;

function highlightStyleFor(theme: TextMateTheme): HighlightStyle {
  const color = (key: keyof typeof SYNTAX_SCOPE_CANDIDATES): string | undefined =>
    scopeColor(theme, SYNTAX_SCOPE_CANDIDATES[key]);
  return HighlightStyle.define([
    { tag: tags.comment, color: color("comment") },
    { tag: tags.string, color: color("string") },
    { tag: tags.number, color: color("number") },
    { tag: tags.bool, color: color("boolean") },
    { tag: [tags.null, tags.atom, tags.unit], color: color("boolean") },
    { tag: tags.constant(tags.name), color: color("constant") },
    { tag: tags.escape, color: color("escape") },
    { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: color("keyword") },
    { tag: tags.operator, color: color("operator") },
    { tag: tags.variableName, color: color("variable") },
    { tag: tags.self, color: color("self") },
    { tag: tags.function(tags.variableName), color: color("function") },
    {
      tag: [tags.function(tags.propertyName), tags.function(tags.variableName)],
      color: color("function"),
    },
    { tag: tags.typeName, color: color("type") },
    { tag: tags.className, color: color("type") },
    { tag: tags.namespace, color: color("namespace") },
    { tag: tags.propertyName, color: color("property") },
    { tag: tags.attributeName, color: color("attribute") },
    { tag: tags.attributeValue, color: color("string") },
    { tag: tags.tagName, color: color("tag") },
    { tag: tags.regexp, color: color("regexp") },
    { tag: tags.punctuation, color: color("punctuation") },
    { tag: tags.contentSeparator, color: color("punctuation") },
    { tag: tags.heading, color: color("heading"), fontWeight: "bold" },
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strikethrough, textDecoration: "line-through" },
    { tag: tags.link, color: color("link") },
    { tag: tags.quote, color: color("quote") },
    { tag: tags.monospace, color: color("monospace") },
    { tag: tags.invalid, color: "var(--destructive)" },
  ]);
}

const highlightCache = new Map<"light" | "dark", Promise<Extension>>();

/**
 * Loads the pierre theme JSON for the resolved app theme and returns the
 * CodeMirror syntax-highlighting extension derived from it. Cached; the first
 * call for a theme resolves after one dynamic import.
 */
export function loadIdeSyntaxHighlighting(theme: "light" | "dark"): Promise<Extension> {
  const cached = highlightCache.get(theme);
  if (cached) return cached;
  const promise = (
    theme === "dark" ? import("@pierre/theme/pierre-dark") : import("@pierre/theme/pierre-light")
  )
    .then((module) => syntaxHighlighting(highlightStyleFor(module.default as TextMateTheme)))
    .catch(() => []);
  highlightCache.set(theme, promise);
  return promise;
}

/**
 * Surface chrome for the editor: background, gutters, selection, caret. All
 * values come from the app's code tokens via `light-dark()`, so this one
 * extension serves both themes and follows theme overrides (custom app
 * palettes) without reconfiguration.
 */
export const ideEditorChrome: Extension = EditorView.theme({
  "&": {
    backgroundColor: "var(--code-background)",
    color: "var(--code-foreground)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-code, 13px)",
    height: "100%",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    caretColor: "var(--code-foreground)",
    paddingBlock: "8px",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.6",
  },
  ".cm-gutters": {
    backgroundColor: "var(--code-background)",
    color: "color-mix(in srgb, var(--code-foreground) 40%, transparent)",
    border: "none",
    borderRight: "1px solid color-mix(in srgb, var(--code-background) 92%, var(--code-foreground))",
    paddingInlineEnd: "4px",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--code-background) 94%, var(--code-foreground))",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in srgb, var(--code-background) 90%, var(--code-foreground))",
    color: "var(--code-foreground)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--primary) 24%, transparent)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--code-foreground)",
  },
  ".cm-matchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--primary) 20%, transparent)",
    outline: "none",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in srgb, var(--primary) 16%, transparent)",
  },
  ".cm-panels": {
    backgroundColor: "var(--card)",
    color: "var(--card-foreground)",
    fontFamily: "var(--font-sans)",
  },
  ".cm-panels input, .cm-panels button": {
    fontFamily: "var(--font-sans)",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--warning, #eab308) 30%, transparent)",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "color-mix(in srgb, var(--warning, #eab308) 55%, transparent)",
  },
});
