import { describe, expect, it } from "vite-plus/test";

import { ideLanguageForPath } from "./language";

describe("ideLanguageForPath", () => {
  it("maps TypeScript and JavaScript variants", () => {
    expect(ideLanguageForPath("src/index.ts")).toBe("typescript");
    expect(ideLanguageForPath("src/App.tsx")).toBe("tsx");
    expect(ideLanguageForPath("lib/util.js")).toBe("javascript");
    expect(ideLanguageForPath("lib/View.jsx")).toBe("jsx");
    expect(ideLanguageForPath("pkg/mod.mts")).toBe("typescript");
  });

  it("maps data and markup formats", () => {
    expect(ideLanguageForPath("package.json")).toBe("json");
    expect(ideLanguageForPath("config/settings.jsonc")).toBe("json");
    expect(ideLanguageForPath("web/page.html")).toBe("html");
    expect(ideLanguageForPath("web/style.css")).toBe("css");
    expect(ideLanguageForPath("icon.svg")).toBe("xml");
  });

  it("maps other languages case-insensitively and across separators", () => {
    expect(ideLanguageForPath("Scripts/Build.PY")).toBe("python");
    expect(ideLanguageForPath("src\\main.rs")).toBe("rust");
    expect(ideLanguageForPath("cmd/server.go")).toBe("go");
    expect(ideLanguageForPath("README.md")).toBe("markdown");
    expect(ideLanguageForPath("deploy/values.yaml")).toBe("yaml");
    expect(ideLanguageForPath("db/query.sql")).toBe("sql");
  });

  it("returns null for extensionless names, dotfiles, and unknown extensions", () => {
    expect(ideLanguageForPath("Makefile")).toBeNull();
    expect(ideLanguageForPath(".env")).toBeNull();
    expect(ideLanguageForPath(".gitignore")).toBeNull();
    expect(ideLanguageForPath("notes.txt")).toBeNull();
    expect(ideLanguageForPath("archive.tar.gz")).toBeNull();
  });
});
