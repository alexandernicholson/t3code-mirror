// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - Node boundary for the standalone installer, shared by plain protocol tests.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";
import { Effect, Schema } from "effect";
import { HostProcessPlatform, HostProcessArchitecture } from "@t3tools/shared/hostProcess";
import type { CodeServerStatus } from "@t3tools/contracts";
import { languageServers, type LanguageServerDefinition } from "./catalog.ts";
import { runCommand } from "./process.ts";

const MISE_VERSION = "2026.9.4";
const Manifest = Schema.Struct({ version: Schema.String, tools: Schema.Array(Schema.String) });
type Manifest = typeof Manifest.Type;
const decodeManifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest));

export interface ServerLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly initializationOptions?: Readonly<Record<string, unknown>>;
  readonly shell?: boolean;
}

export async function findExecutable(
  command: string,
  cwd: string,
  env = process.env,
  platform: NodeJS.Platform = Effect.runSync(HostProcessPlatform),
): Promise<string | undefined> {
  const candidates =
    NodePath.isAbsolute(command) || command.includes(NodePath.sep)
      ? [NodePath.resolve(cwd, command)]
      : [
          NodePath.join(cwd, "node_modules", ".bin", command),
          NodePath.join(cwd, ".venv", platform === "win32" ? "Scripts" : "bin", command),
          ...(env.PATH ?? "").split(NodePath.delimiter).map((dir) => NodePath.join(dir, command)),
        ];
  for (const candidate of candidates) {
    for (const suffix of platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""]) {
      try {
        await NodeFSP.access(
          candidate + suffix,
          platform === "win32" ? NodeFSP.constants.F_OK : NodeFSP.constants.X_OK,
        );
        if ((await NodeFSP.stat(candidate + suffix)).isFile()) return candidate + suffix;
      } catch {
        /* Continue through the configured executable search path. */
      }
    }
  }
  return undefined;
}

/** Shared environment installs; worktree ownership belongs to the LSP session pool. */
export class LanguageServerInstaller {
  readonly root: string;
  readonly runtime: { platform: NodeJS.Platform; architecture: string };
  private readonly changed: () => void;
  readonly manifests = new Map<string, Manifest>();
  readonly jobs = new Map<
    string,
    { controller: AbortController; promise: Promise<void>; version: string }
  >();
  readonly details = new Map<string, { status: "installing" | "error"; detail: string }>();
  private bootstrap: Promise<string> | undefined;
  readonly env: NodeJS.ProcessEnv;
  constructor(
    root: string,
    changed: () => void,
    runtime: { platform: NodeJS.Platform; architecture: string } = {
      platform: Effect.runSync(HostProcessPlatform),
      architecture: Effect.runSync(HostProcessArchitecture),
    },
  ) {
    this.runtime = runtime;
    this.root = root;
    this.changed = changed;
    this.env = {
      ...process.env,
      MISE_DATA_DIR: NodePath.join(root, "mise", "data"),
      MISE_CONFIG_DIR: NodePath.join(root, "mise", "config"),
      MISE_CACHE_DIR: NodePath.join(root, "mise", "cache"),
      MISE_STATE_DIR: NodePath.join(root, "mise", "state"),
      MISE_CONFIG_FILE: NodePath.join(root, "mise", "config", "config.toml"),
      MISE_YES: "1",
      MISE_COLOR: "0",
      NO_COLOR: "1",
    };
  }
  private manifestPath(id: string) {
    return NodePath.join(
      this.root,
      "servers",
      `${NodeCrypto.createHash("sha256").update(id).digest("hex")}.json`,
    );
  }
  async initialize() {
    await NodeFSP.mkdir(NodePath.join(this.root, "servers"), { recursive: true });
    for (const server of languageServers) {
      try {
        this.manifests.set(
          server.id,
          decodeManifest(await NodeFSP.readFile(this.manifestPath(server.id), "utf8")),
        );
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
          this.details.set(server.id, {
            status: "error",
            detail: "The saved installation is invalid. Reinstall this server.",
          });
      }
    }
  }
  private async download(url: string, signal: AbortSignal, maxBytes: number): Promise<Buffer> {
    const response = await fetch(url, { signal });
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error("The installer download exceeded its size limit.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  private mise(signal: AbortSignal): Promise<string> {
    if (this.bootstrap) return this.bootstrap;
    const promise = (async () => {
      const platform =
        this.runtime.platform === "darwin"
          ? "macos"
          : this.runtime.platform === "win32"
            ? "windows"
            : this.runtime.platform;
      if (
        !["linux", "macos", "windows"].includes(platform) ||
        !["x64", "arm64"].includes(this.runtime.architecture)
      )
        throw new Error(
          "Managed installation is unavailable on this platform. Configure an existing language-server command.",
        );
      const asset = `mise-v${MISE_VERSION}-${platform}-${this.runtime.architecture}${platform === "linux" ? "-musl" : ""}${platform === "windows" ? ".exe" : ""}`;
      const binary = NodePath.join(this.root, asset);
      await NodeFSP.mkdir(NodePath.dirname(this.env.MISE_CONFIG_FILE!), { recursive: true });
      await NodeFSP.writeFile(this.env.MISE_CONFIG_FILE!, "", { flag: "a" });
      try {
        await NodeFSP.access(binary, NodeFSP.constants.X_OK);
        return binary;
      } catch {
        /* Bootstrap the pinned installer on first use. */
      }
      const base = `https://github.com/jdx/mise/releases/download/v${MISE_VERSION}`;
      const checksums = (
        await this.download(`${base}/SHASUMS256.txt`, signal, 1_000_000)
      ).toString();
      const line = checksums.split("\n").find(
        (entry) =>
          entry
            .trim()
            .split(/\s+/)
            .at(-1)
            ?.replace(/^\*?(?:\.\/)?/, "") === asset,
      );
      const expected = line?.trim().split(/\s+/)[0];
      if (!expected)
        throw new Error("No verified installer artifact is available for this platform.");
      const bytes = await this.download(`${base}/${asset}`, signal, 150_000_000);
      if (NodeCrypto.createHash("sha256").update(bytes).digest("hex") !== expected)
        throw new Error("Installer checksum did not match.");
      const temporary = `${binary}.${process.pid}.tmp`;
      try {
        await NodeFSP.writeFile(temporary, bytes, { mode: 0o755 });
        await NodeFSP.rename(temporary, binary);
      } finally {
        await NodeFSP.rm(temporary, { force: true });
      }
      return binary;
    })();
    this.bootstrap = promise;
    void promise.catch(() => {
      if (this.bootstrap === promise) this.bootstrap = undefined;
    });
    return promise;
  }
  async resolve(
    server: LanguageServerDefinition,
    cwd: string,
    explicitCommand?: string,
  ): Promise<ServerLaunch | undefined> {
    if (explicitCommand) {
      const command = await findExecutable(
        explicitCommand,
        cwd,
        process.env,
        this.runtime.platform,
      );
      if (!command) throw new Error(`Configured command is unavailable: ${explicitCommand}`);
      return { command, args: server.args, env: process.env };
    }
    // A project's installed language server travels with its compiler/toolchain.
    for (const local of [
      NodePath.join(cwd, "node_modules", ".bin", server.command),
      NodePath.join(
        cwd,
        ".venv",
        this.runtime.platform === "win32" ? "Scripts" : "bin",
        server.command,
      ),
    ]) {
      const command = await findExecutable(local, cwd, process.env, this.runtime.platform);
      if (command) return { command, args: server.args, env: process.env };
    }
    const manifest = this.manifests.get(server.id);
    if (manifest) {
      const command = await this.mise(AbortSignal.timeout(120_000));
      let initializationOptions: Record<string, unknown> | undefined;
      if (server.id === "typescript") {
        let tsserver: string | undefined;
        try {
          tsserver = NodeModule.createRequire(NodePath.join(cwd, "package.json")).resolve(
            "typescript/lib/tsserver.js",
          );
        } catch {
          /* Use the managed compiler when this project has none. */
        }
        if (!tsserver) {
          const compiler = manifest.tools.find((tool) => tool.startsWith("npm:typescript@"));
          if (compiler) {
            const directory = (
              await runCommand(command, ["where", compiler], { cwd: this.root, env: this.env })
            ).trim();
            for (const relative of [
              "lib/node_modules/typescript/lib/tsserver.js",
              "node_modules/typescript/lib/tsserver.js",
            ]) {
              try {
                await NodeFSP.access(NodePath.join(directory, relative));
                tsserver = NodePath.join(directory, relative);
                break;
              } catch {
                /* Installer backends use different package prefixes. */
              }
            }
          }
        }
        if (tsserver) initializationOptions = { tsserver: { path: tsserver } };
      }
      return {
        command,
        args: ["exec", ...manifest.tools, "--", server.command, ...server.args],
        env: this.env,
        ...(initializationOptions ? { initializationOptions } : {}),
      };
    }
    const command = await findExecutable(server.command, cwd, process.env, this.runtime.platform);
    return command ? { command, args: server.args, env: process.env } : undefined;
  }
  install(server: LanguageServerDefinition, requestedVersion = "latest"): Promise<void> {
    const active = this.jobs.get(server.id);
    if (active)
      return active.version === requestedVersion
        ? active.promise
        : Promise.reject(
            new Error(
              "Another version is already installing. Wait for it to finish or cancel it first.",
            ),
          );
    if (!server.package)
      return Promise.reject(
        new Error("Install this language's toolchain or configure a custom command."),
      );
    if (!/^[A-Za-z0-9._+-]+$/.test(requestedVersion))
      return Promise.reject(new Error("Enter a release version or latest."));
    const controller = new AbortController();
    const report = (detail: string) => {
      this.details.set(server.id, { status: "installing", detail });
      this.changed();
    };
    report("Preparing installation…");
    const promise = (async () => {
      try {
        const mise = await this.mise(controller.signal);
        const options = {
          cwd: this.root,
          env: this.env,
          signal: controller.signal,
          timeoutMs: 600_000,
        };
        const requested = [
          ...(server.runtime ? [server.runtime] : []),
          ...(server.companions ?? []),
          `${server.package}@${requestedVersion}`,
        ];
        const tools: string[] = [];
        for (const spec of requested) {
          report(`Resolving ${spec}…`);
          const version = (await runCommand(mise, ["latest", spec], options)).trim();
          if (!version || version.includes("\n")) throw new Error(`Could not resolve ${spec}.`);
          tools.push(`${spec.slice(0, spec.lastIndexOf("@"))}@${version}`);
        }
        report("Downloading and installing the language server and required runtime…");
        await runCommand(mise, ["install", ...tools], options);
        // Verify execution, not just the presence of downloaded package files.
        report("Verifying installation…");
        await runCommand(mise, ["exec", ...tools, "--", server.command, "--version"], {
          ...options,
          timeoutMs: 30_000,
        }).catch(async () => {
          // A few LSP executables have no --version; mise must still resolve the command.
          await runCommand(mise, ["which", server.command, "--tool", tools.at(-1)!], options);
        });
        const version = tools.at(-1)!.slice(tools.at(-1)!.lastIndexOf("@") + 1);
        const manifest = { tools, version };
        const file = this.manifestPath(server.id);
        await NodeFSP.writeFile(`${file}.tmp`, JSON.stringify(manifest));
        await NodeFSP.rename(`${file}.tmp`, file);
        this.manifests.set(server.id, manifest);
        this.details.delete(server.id);
      } catch (error) {
        this.details.set(server.id, {
          status: "error",
          detail: controller.signal.aborted
            ? "Installation cancelled. You can retry."
            : error instanceof Error
              ? error.message.slice(-2_000)
              : "Installation failed.",
        });
        throw error;
      } finally {
        this.jobs.delete(server.id);
        this.changed();
      }
    })();
    this.jobs.set(server.id, { controller, promise, version: requestedVersion });
    return promise;
  }
  cancel(id: string) {
    this.jobs.get(id)?.controller.abort();
  }
  async remove(id: string) {
    if (this.jobs.size > 0)
      throw new Error("Wait for active installations to finish before removing shared tools.");
    if (this.jobs.has(id)) throw new Error("Cancel the installation before removing this server.");
    const manifest = this.manifests.get(id);
    if (manifest) {
      const others = new Set(
        [...this.manifests].filter(([key]) => key !== id).flatMap(([, value]) => value.tools),
      );
      const unused = manifest.tools.filter((tool) => !others.has(tool));
      if (unused.length)
        await runCommand(await this.mise(AbortSignal.timeout(120_000)), ["uninstall", ...unused], {
          cwd: this.root,
          env: this.env,
        });
    }
    await NodeFSP.rm(this.manifestPath(id), { force: true });
    this.manifests.delete(id);
    this.details.delete(id);
    this.changed();
  }
  async statuses(): Promise<CodeServerStatus[]> {
    return Promise.all(
      languageServers.map(async (server) => {
        const detail = this.details.get(server.id);
        const installed = this.manifests.get(server.id);
        const external =
          !installed &&
          (await findExecutable(server.command, this.root, process.env, this.runtime.platform));
        return {
          id: server.id,
          name: server.name,
          languages: server.languages,
          extensions: server.extensions,
          status:
            detail?.status ?? (installed ? "installed" : external ? "external" : "not-installed"),
          version: installed?.version ?? null,
          detail:
            detail?.detail ??
            (external
              ? "Available on this environment"
              : server.package
                ? ""
                : "Provided by the Swift toolchain"),
          canInstall:
            !!server.package &&
            ["linux", "darwin", "win32"].includes(this.runtime.platform) &&
            ["x64", "arm64"].includes(this.runtime.architecture),
          sessions: 0,
        };
      }),
    );
  }
  async close() {
    for (const job of this.jobs.values()) job.controller.abort();
    await Promise.allSettled([...this.jobs.values()].map((job) => job.promise));
  }
}
