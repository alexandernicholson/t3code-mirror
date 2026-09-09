import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeVM from "node:vm";
import { describe, expect, it } from "vite-plus/test";

const mobileRoot = NodeURL.fileURLToPath(new URL("../apps/mobile", import.meta.url));
const requireMobile = NodeModule.createRequire(NodePath.join(mobileRoot, "package.json"));
const expoRoot = NodePath.dirname(requireMobile.resolve("expo/package.json"));
const requireExpo = NodeModule.createRequire(NodePath.join(expoRoot, "package.json"));
const cliRoot = NodePath.dirname(requireExpo.resolve("@expo/cli/package.json"));

type Artifact = {
  filename: string;
  type: string;
  source: string;
  metadata: { isAsync?: boolean; requires?: string[] };
};
type ExportFile = { contents: string | Buffer };
const { exportDomComponentAsync } = requireExpo(
  NodePath.join(cliRoot, "build/src/export/exportDomComponents.js"),
) as {
  exportDomComponentAsync: (input: {
    filePath: string;
    projectRoot: string;
    dev: boolean;
    isHermes: boolean;
    includeSourceMaps: boolean;
    exp: object;
    files: Map<string, ExportFile>;
    useMd5Filename: boolean;
    devServer: {
      legacySinglePageExportBundleAsync: (options: { splitChunks: boolean }) => Promise<{
        artifacts: Artifact[];
        assets: never[];
      }>;
    };
  }) => Promise<{ htmlOutputName: string }>;
};

const hash = (source: string) => NodeCrypto.createHash("md5").update(source).digest("hex");
const chunk = (name: string) => `_expo/static/js/web/${name}.js`;
const artifact = (
  name: string,
  source: string,
  isAsync = false,
  requires: string[] = [],
): Artifact => ({
  filename: chunk(name),
  type: "js",
  source,
  metadata: { isAsync, requires },
});

async function exportFixture(artifacts: Artifact[], useMd5Filename = true) {
  const files = new Map<string, ExportFile>();
  const { htmlOutputName } = await exportDomComponentAsync({
    filePath: NodePath.join(mobileRoot, "src/features/threads/MermaidDiagramDOM.tsx"),
    projectRoot: mobileRoot,
    dev: false,
    isHermes: true,
    includeSourceMaps: false,
    exp: {},
    files,
    useMd5Filename,
    devServer: {
      legacySinglePageExportBundleAsync: async ({ splitChunks }) => {
        expect(splitChunks).toBe(true);
        return { artifacts, assets: [] };
      },
    },
  });
  const html = files.get(htmlOutputName)!.contents.toString();
  return { files, html };
}

// Run the installed Expo loader and generated HTML bootstrap without React Native.
function createLoader(html: string, baseURI: string) {
  const context = NodeVM.createContext({ URL, document: { baseURI } });
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    if (match[1]!.includes("__EXPO_DOM_BUNDLE_URLS__")) NodeVM.runInContext(match[1]!, context);
  }
  const source = NodeModule.stripTypeScriptTypes(
    NodeFS.readFileSync(NodePath.join(expoRoot, "src/async-require/buildUrlForBundle.ts"), "utf8"),
  )
    .replace(
      "import getDevServer from './getDevServer';",
      "const getDevServer = () => ({url: 'https://app.example/'});",
    )
    .replace("export function", "function");
  const resolve = NodeVM.runInContext(`${source}\nbuildUrlForBundle`, context) as (
    url: string,
  ) => string;
  return { resolve, context };
}

describe("Expo native DOM exports", () => {
  it("renames dependency metadata while keeping every asset's content hash valid", async () => {
    const common = artifact("common", "globalThis.shared = 1;");
    const entry = artifact("entry", "globalThis.result = globalThis.shared;", false, [
      common.filename,
    ]);
    const originals = [entry.source, common.source];
    const { files, html } = await exportFixture([entry, common]);
    expect(entry.metadata.requires).toEqual([common.filename]);
    for (const [index, item] of [entry, common].entries()) {
      expect(item.source).toBe(originals[index]);
      expect(item.filename).toBe(`${hash(item.source)}.js`);
      expect(files.get(`/www.bundle/${item.filename}`)?.contents).toBe(item.source);
    }
    expect(html.indexOf(`src="./${common.filename}"`)).toBeLessThan(
      html.indexOf(`src="./${entry.filename}"`),
    );
  });

  it.each([
    "file:///android_asset/www.bundle/index.html",
    "file:///private/app/www.bundle/index.html",
    "https://app.example/nested/www.bundle/index.html",
  ])("loads nested lazy chunks from their hashed files at %s", async (baseURI) => {
    const first = artifact("first", `load('./${chunk("second")}');`, true);
    const second = artifact("second", "globalThis.result = 42;", true);
    const entry = artifact("entry", `load('./${first.filename}');`);
    const { files, html } = await exportFixture([entry, first, second]);
    const { resolve, context } = createLoader(html, baseURI);
    const requested: string[] = [];
    context.load = (url: string) => {
      const target = new URL(resolve(url));
      requested.push(target.href);
      const filename = target.pathname.split("/").at(-1)!;
      const file = files.get(`/www.bundle/${filename}`);
      expect(file).toBeDefined();
      NodeVM.runInContext(file!.contents.toString(), context);
    };
    expect(html).not.toContain(`src="./${first.filename}"`);
    expect(html).not.toContain(`src="./${second.filename}"`);
    NodeVM.runInContext(entry.source, context);
    expect(context.result).toBe(42);
    expect(requested).toEqual([
      new URL(first.filename, baseURI).href,
      new URL(second.filename, baseURI).href,
    ]);
  });

  it("preserves hashes and resolves mutual async imports without circular rehashing", async () => {
    const a = artifact("a", `globalThis.targetB = './${chunk("b")}';`, true);
    const b = artifact("b", `globalThis.targetA = './${chunk("a")}';`, true);
    const { html } = await exportFixture([a, b]);
    const baseURI = "file:///app/www.bundle/index.html";
    const { resolve, context } = createLoader(html, baseURI);
    NodeVM.runInContext(a.source, context);
    NodeVM.runInContext(b.source, context);
    expect(resolve(context.targetB)).toBe(new URL(b.filename, baseURI).href);
    expect(resolve(context.targetA)).toBe(new URL(a.filename, baseURI).href);
    expect(a.filename).toBe(`${hash(a.source)}.js`);
    expect(b.filename).toBe(`${hash(b.source)}.js`);
  });

  it("escapes script delimiters in the URL map", async () => {
    const item = artifact("</script><script>throw 1</script>", "globalThis.safe = true;", true);
    const original = item.filename;
    const { html } = await exportFixture([item]);
    expect(html).not.toContain("<script>throw 1</script>");
    const baseURI = "file:///app/www.bundle/index.html";
    expect(createLoader(html, baseURI).resolve(`./${original}`)).toBe(
      new URL(item.filename, baseURI).href,
    );
  });

  it("leaves ordinary web exports and external URLs unchanged", async () => {
    const entry = artifact("entry", "globalThis.result = 1;");
    const { html } = await exportFixture([entry], false);
    expect(entry.filename).toBe(chunk("entry"));
    expect(html).not.toContain("__EXPO_DOM_BUNDLE_URLS__");
    const { resolve } = createLoader(html, "https://app.example/index.html");
    expect(resolve("./chunk.js")).toBe("https://app.example/chunk.js");
    expect(resolve("https://cdn.example/chunk.js")).toBe("https://cdn.example/chunk.js");
  });
});
