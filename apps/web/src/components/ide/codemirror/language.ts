import type { Extension } from "@codemirror/state";

/**
 * Language identifiers the IDE knows how to load. Everything else renders
 * without syntax support; CodeMirror still edits it fine.
 */
export type IdeLanguageId =
  | "javascript"
  | "jsx"
  | "typescript"
  | "tsx"
  | "json"
  | "css"
  | "html"
  | "python"
  | "rust"
  | "go"
  | "markdown"
  | "yaml"
  | "sql"
  | "xml";

const EXTENSION_LANGUAGE_MAP: Readonly<Record<string, IdeLanguageId>> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  json: "json",
  jsonc: "json",
  json5: "json",
  css: "css",
  html: "html",
  htm: "html",
  py: "python",
  pyi: "python",
  rs: "rust",
  go: "go",
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  xml: "xml",
  svg: "xml",
};

/** Maps a workspace-relative path to a loadable language, or null. */
export function ideLanguageForPath(path: string): IdeLanguageId | null {
  const normalized = path.replaceAll("\\", "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
  const dotIndex = basename.lastIndexOf(".");
  // Dotfiles like ".env" have no extension; a bare name has no dot.
  if (dotIndex <= 0) return null;
  const extension = basename.slice(dotIndex + 1);
  return EXTENSION_LANGUAGE_MAP[extension] ?? null;
}

/**
 * Dynamically imports the language package so each grammar lands in its own
 * chunk instead of the IDE's entry chunk. A null id resolves to no support.
 */
export async function loadIdeLanguage(id: IdeLanguageId | null): Promise<Extension> {
  switch (id) {
    case null:
      return [];
    case "javascript":
      return (await import("@codemirror/lang-javascript")).javascript();
    case "jsx":
      return (await import("@codemirror/lang-javascript")).javascript({ jsx: true });
    case "typescript":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true });
    case "tsx":
      return (await import("@codemirror/lang-javascript")).javascript({
        typescript: true,
        jsx: true,
      });
    case "json":
      return (await import("@codemirror/lang-json")).json();
    case "css":
      return (await import("@codemirror/lang-css")).css();
    case "html":
      return (await import("@codemirror/lang-html")).html();
    case "python":
      return (await import("@codemirror/lang-python")).python();
    case "rust":
      return (await import("@codemirror/lang-rust")).rust();
    case "go":
      return (await import("@codemirror/lang-go")).go();
    case "markdown":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "yaml":
      return (await import("@codemirror/lang-yaml")).yaml();
    case "sql":
      return (await import("@codemirror/lang-sql")).sql();
    case "xml":
      return (await import("@codemirror/lang-xml")).xml();
  }
}
