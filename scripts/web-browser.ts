import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import { chromium, type Page, type BrowserContext } from "playwright-core";

const HELP = `Web development browser

  vp run browser:install                 Install the pinned Chromium build
  vp run browser:doctor                  Check browser installation without launching
  vp run browser:self-test               Verify the tooling against a disposable local page
  vp run screenshots:web --url URL --wait-for SELECTOR [options]
  vp run test:web:browser --url URL --script /absolute/path/check.ts [options]

Options:
  --pair-url-file FILE   Read a fresh pairing URL from a file (never logged)
  --state-dir DIR       Browser auth directory (default .t3/browser)
  --output FILE         PNG destination (default .t3/browser/screenshot.png)
  --wait-for SELECTOR   Wait until the target UI is visible before capture
  --script FILE         Module exporting async default ({ page, context })
  --width NUMBER        Viewport width (default 1440)
  --height NUMBER       Viewport height (default 900)
  --timeout NUMBER      Navigation/locator timeout in ms (default 30000)
  --full-page           Capture the full page
  --help                Show this help

Start an isolated server with vp run dev first. Reuse its printed origin.
Pair once using --pair-url-file; subsequent runs reuse saved authentication.
Scripts use Playwright locators and assertions and must throw on failure.
Use separate state directories for different environments or concurrent runs.
`;

export interface BrowserCheck {
  (input: { page: Page; context: BrowserContext }): Promise<void>;
}

export function parseBrowserArgs(args: string[]) {
  const { values } = NodeUtil.parseArgs({
    args,
    options: {
      help: { type: "boolean" },
      doctor: { type: "boolean" },
      url: { type: "string" },
      "pair-url-file": { type: "string" },
      "state-dir": { type: "string", default: ".t3/browser" },
      output: { type: "string" },
      "wait-for": { type: "string" },
      script: { type: "string" },
      width: { type: "string", default: "1440" },
      height: { type: "string", default: "900" },
      timeout: { type: "string", default: "30000" },
      "full-page": { type: "boolean", default: false },
    },
  });
  const positiveInteger = (value: string, name: string) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
      throw new Error(`--${name} must be a positive integer.`);
    }
    return number;
  };
  if (!values.help && !values.doctor) {
    if (!values.url) throw new Error("Supply --url using the dev runner's printed web origin.");
    const url = new URL(values.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname === "/pair" ||
      url.hash.includes("token=")
    ) {
      throw new Error(
        "--url must be an HTTP(S) page URL without credentials. Use --pair-url-file for pairing.",
      );
    }
    if (!values.script && !values["wait-for"]) {
      throw new Error("Supply --wait-for or --script to establish UI readiness before capture.");
    }
  }
  return {
    ...values,
    width: positiveInteger(values.width, "width"),
    height: positiveInteger(values.height, "height"),
    timeout: positiveInteger(values.timeout, "timeout"),
  };
}

export function validatePairingUrl(value: string, targetUrl: string) {
  const url = new URL(value.trim());
  if (
    url.origin !== new URL(targetUrl).origin ||
    url.pathname !== "/pair" ||
    !new URLSearchParams(url.hash.slice(1)).get("token") ||
    url.username ||
    url.password
  ) {
    throw new Error("Pairing URL must contain a token and match the --url origin.");
  }
  return url.href;
}

export async function runBrowser(args: string[]) {
  const options = parseBrowserArgs(args);
  if (options.help) {
    NodeProcess.stdout.write(HELP);
    return;
  }
  const executable = chromium.executablePath();
  try {
    await NodeFSP.access(executable);
  } catch {
    throw new Error(
      "Chromium is missing. Run vp run browser:install. On Linux, install system libraries with vp exec playwright-core install-deps chromium if needed.",
    );
  }
  if (NodeProcess.platform === "linux") {
    const { stdout } = await NodeUtil.promisify(NodeChildProcess.execFile)("ldd", [executable]);
    const missing = stdout.split("\n").filter((line) => line.includes("not found"));
    if (missing.length > 0) {
      throw new Error(
        `Chromium system libraries are missing:\n${missing.join("\n")}\nRun vp exec playwright-core install-deps chromium during host/container setup. This requires package-install privileges; in restricted containers, provision the image first or supply an existing user-local library directory through LD_LIBRARY_PATH.`,
      );
    }
  }
  if (options.doctor) {
    NodeProcess.stdout.write(
      `Chromium installed: ${executable}\nNo desktop preview host is required. Run a screenshot or check script to verify launch and system libraries.\n`,
    );
    return;
  }
  const targetUrl = options.url!;
  const stateDir = NodePath.resolve(options["state-dir"]);
  await NodeFSP.mkdir(stateDir, { recursive: true, mode: 0o700 });
  // Lock only our browser state; never attach to a developer's browser profile.
  const lockPath = NodePath.join(stateDir, "running.lock");
  const lock = await NodeFSP.open(lockPath, "wx").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") {
      throw new Error(
        "Browser state is in use. Use another --state-dir for concurrent checks. If a previous run crashed, remove its running.lock only after confirming that run has stopped.",
      );
    }
    throw error;
  });
  try {
    const pairUrl = options["pair-url-file"]
      ? validatePairingUrl(await NodeFSP.readFile(options["pair-url-file"], "utf8"), targetUrl)
      : undefined;
    // T3 stores connections in IndexedDB; retain a dedicated profile rather
    // than exporting only cookies/localStorage and losing authentication.
    const context = await chromium.launchPersistentContext(NodePath.join(stateDir, "profile"), {
      channel: "chromium",
      headless: true,
      viewport: { width: options.width, height: options.height },
    });
    context.setDefaultTimeout(options.timeout);
    context.setDefaultNavigationTimeout(options.timeout);
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      if (pairUrl) {
        // Do not emit Playwright errors containing the one-time credential.
        try {
          await page.goto(pairUrl, { waitUntil: "domcontentloaded" });
          await page.waitForURL((url) => url.pathname !== "/pair" && !url.hash.includes("token="));
        } catch {
          throw new Error(
            "Pairing failed or timed out. Mint a fresh token for this isolated environment and retry.",
          );
        }
      }
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      if (options.script) {
        const module = await import(NodeURL.pathToFileURL(NodePath.resolve(options.script)).href);
        if (typeof module.default !== "function")
          throw new Error("Check script must export a default function.");
        await (module.default as BrowserCheck)({ page, context });
      }
      if (options["wait-for"])
        await page.locator(options["wait-for"]).waitFor({ state: "visible" });
      if (new URL(page.url()).pathname === "/pair" || new URL(page.url()).hash.includes("token=")) {
        throw new Error("Browser is still on the pairing page. Supply a fresh --pair-url-file.");
      }
      const output = NodePath.resolve(options.output ?? NodePath.join(stateDir, "screenshot.png"));
      await NodeFSP.mkdir(NodePath.dirname(output), { recursive: true });
      await page.screenshot({
        path: output,
        type: "png",
        fullPage: options["full-page"],
        animations: "disabled",
      });
      NodeProcess.stdout.write(`Browser check passed. Screenshot: ${output}\n`);
    } finally {
      await context.close();
    }
  } finally {
    await lock.close();
    await NodeFSP.unlink(NodePath.join(stateDir, "running.lock"));
  }
}

if (import.meta.url === NodeURL.pathToFileURL(NodeProcess.argv[1] ?? "").href) {
  runBrowser(NodeProcess.argv.slice(2)).catch((error: unknown) => {
    NodeProcess.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    NodeProcess.exit(1);
  });
}
