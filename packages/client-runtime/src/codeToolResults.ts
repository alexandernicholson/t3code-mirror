import { Predicate } from "effect";
import type { CodeDiagnostic } from "@t3tools/contracts";
export const codeDiagnosticKey = (diagnostic: CodeDiagnostic): string =>
  JSON.stringify([
    diagnostic.file,
    diagnostic.line,
    diagnostic.character,
    diagnostic.source,
    diagnostic.code,
    diagnostic.message,
  ]);

export const codeDiagnosticText = (diagnostic: CodeDiagnostic): string =>
  diagnostic.guidance ? `${diagnostic.message}\n${diagnostic.guidance}` : diagnostic.message;

export interface CodeToolDisplayItem {
  readonly text: string;
  readonly file?: string;
  readonly line?: number;
  readonly actionIndex?: number;
  readonly before?: string;
  readonly after?: string;
}

function location(uri: string): string | undefined {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") return undefined;
    let file = decodeURIComponent(url.pathname);
    if (url.hostname) return `//${url.hostname}${file}`;
    if (/^\/[A-Za-z]:\//.test(file)) file = file.slice(1);
    return file;
  } catch {
    return undefined;
  }
}
function lineNumber(range: unknown): number {
  return Predicate.isObject(range) &&
    Predicate.isObject(range.start) &&
    typeof range.start.line === "number"
    ? range.start.line + 1
    : 1;
}
/** Present standard LSP results consistently on web and native clients. */
export function codeToolDisplayItems(data: unknown, file?: string): CodeToolDisplayItem[] {
  if (data === null || data === undefined) return [];
  if (Array.isArray(data)) return data.flatMap((item) => codeToolDisplayItems(item, file));
  if (typeof data === "string") return [{ text: data }];
  if (!Predicate.isObject(data)) return [{ text: String(data) }];
  if (
    typeof data.file === "string" &&
    typeof data.before === "string" &&
    typeof data.after === "string"
  )
    return [{ text: data.file, before: data.before, after: data.after }];
  if (typeof data.title === "string" && typeof data.index === "number")
    return [{ text: data.title, actionIndex: data.index }];
  if ("contents" in data) return codeToolDisplayItems(data.contents, file);
  if (typeof data.value === "string") return [{ text: data.value }];
  if (typeof data.targetUri === "string")
    return codeToolDisplayItems(
      { uri: data.targetUri, range: data.targetSelectionRange ?? data.targetRange },
      file,
    );
  if (typeof data.uri === "string") {
    const target = location(data.uri);
    const line = lineNumber(data.range);
    return [{ text: `${target ?? data.uri}:${line}`, ...(target ? { file: target, line } : {}) }];
  }
  if (typeof data.name === "string") {
    const target =
      Predicate.isObject(data.location) && typeof data.location.uri === "string"
        ? location(data.location.uri)
        : file;
    const line = lineNumber(
      Predicate.isObject(data.location) ? data.location.range : (data.selectionRange ?? data.range),
    );
    return [
      {
        text: `${data.name}${typeof data.detail === "string" ? ` · ${data.detail}` : ""}`,
        ...(target ? { file: target, line } : {}),
      },
      ...codeToolDisplayItems(data.children, file),
    ];
  }
  return [{ text: JSON.stringify(data, null, 2) }];
}
