/** Installation metadata contains no code policy; rules belong to the workspace. */
export interface LanguageServerDefinition {
  readonly id: string;
  readonly name: string;
  readonly languages: readonly string[];
  readonly extensions: readonly string[];
  readonly rootMarkers: readonly string[];
  readonly command: string;
  readonly args: readonly string[];
  readonly package?: string;
  readonly runtime?: string;
  readonly companions?: readonly string[];
}

export const languageServers: readonly LanguageServerDefinition[] = [
  {
    id: "typescript",
    name: "TypeScript / JavaScript",
    languages: ["typescript", "javascript", "typescriptreact", "javascriptreact"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
    command: "typescript-language-server",
    args: ["--stdio"],
    package: "npm:typescript-language-server",
    runtime: "node@24",
    companions: ["npm:typescript@6"],
  },
  {
    id: "python",
    name: "Python · Basedpyright",
    languages: ["python"],
    extensions: [".py", ".pyi"],
    rootMarkers: ["pyproject.toml", "pyrightconfig.json", "setup.py", "requirements.txt"],
    command: "basedpyright-langserver",
    args: ["--stdio"],
    package: "npm:basedpyright",
    runtime: "node@24",
  },
  {
    id: "rust",
    name: "Rust Analyzer",
    languages: ["rust"],
    extensions: [".rs"],
    rootMarkers: ["Cargo.toml"],
    command: "rust-analyzer",
    args: [],
    package: "aqua:rust-lang/rust-analyzer",
  },
  {
    id: "go",
    name: "Go · gopls",
    languages: ["go"],
    extensions: [".go"],
    rootMarkers: ["go.work", "go.mod"],
    command: "gopls",
    args: ["serve"],
    package: "go:golang.org/x/tools/gopls",
    runtime: "go@latest",
  },
  {
    id: "clangd",
    name: "C / C++ · clangd",
    languages: ["c", "cpp"],
    extensions: [".c", ".h", ".cpp", ".cc", ".hpp", ".cxx"],
    rootMarkers: ["compile_commands.json", ".clangd", "CMakeLists.txt"],
    command: "clangd",
    args: [],
    package: "aqua:clangd/clangd",
  },
  {
    id: "json",
    name: "JSON",
    languages: ["json", "jsonc"],
    extensions: [".json", ".jsonc"],
    rootMarkers: [],
    command: "vscode-json-language-server",
    args: ["--stdio"],
    package: "npm:vscode-langservers-extracted",
    runtime: "node@24",
  },
  {
    id: "html",
    name: "HTML",
    languages: ["html"],
    extensions: [".html", ".htm"],
    rootMarkers: ["package.json"],
    command: "vscode-html-language-server",
    args: ["--stdio"],
    package: "npm:vscode-langservers-extracted",
    runtime: "node@24",
  },
  {
    id: "css",
    name: "CSS",
    languages: ["css", "scss", "less"],
    extensions: [".css", ".scss", ".less"],
    rootMarkers: ["package.json"],
    command: "vscode-css-language-server",
    args: ["--stdio"],
    package: "npm:vscode-langservers-extracted",
    runtime: "node@24",
  },
  {
    id: "yaml",
    name: "YAML",
    languages: ["yaml"],
    extensions: [".yaml", ".yml"],
    rootMarkers: [],
    command: "yaml-language-server",
    args: ["--stdio"],
    package: "npm:yaml-language-server",
    runtime: "node@24",
  },
  {
    id: "bash",
    name: "Bash",
    languages: ["shellscript"],
    extensions: [".sh", ".bash"],
    rootMarkers: [],
    command: "bash-language-server",
    args: ["start"],
    package: "npm:bash-language-server",
    runtime: "node@24",
  },
  {
    id: "swift",
    name: "Swift · SourceKit-LSP",
    languages: ["swift"],
    extensions: [".swift"],
    rootMarkers: ["Package.swift"],
    command: "sourcekit-lsp",
    args: [],
  },
  {
    id: "ast-grep",
    name: "Structural checks · ast-grep",
    languages: [],
    extensions: [],
    rootMarkers: [],
    command: "ast-grep",
    args: [],
    package: "aqua:ast-grep/ast-grep",
  },
];

export function languageId(server: LanguageServerDefinition, file: string): string {
  const index = server.extensions.findIndex((extension) => file.endsWith(extension));
  if (server.id === "typescript")
    return file.endsWith(".tsx")
      ? "typescriptreact"
      : file.endsWith(".jsx")
        ? "javascriptreact"
        : [".ts", ".mts", ".cts"].some((ext) => file.endsWith(ext))
          ? "typescript"
          : "javascript";
  return server.languages[index] ?? server.languages[0] ?? server.id;
}
