// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Cancellable Node subprocess boundary used by the LSP and installer libraries.
import * as NodeChildProcess from "node:child_process";
import { Effect } from "effect";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

/** Node watch mode emits dependency messages over child IPC, which corrupts tsserver's protocol. */
export function codeToolEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const clean = { ...environment };
  delete clean.WATCH_REPORT_DEPENDENCIES;
  return clean;
}

/** Bounded, cancellable child output. Only processes created here are terminated. */
export async function runCommand(
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    onOutput?: (text: string) => void;
    timeoutMs?: number;
    acceptedExitCodes?: readonly number[];
  },
): Promise<string> {
  const resolved = await Effect.runPromise(
    resolveSpawnCommand(command, args, options.env ? { env: options.env } : {}),
  );
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
    timer.unref();
    const child = NodeChildProcess.spawn(resolved.command, resolved.args, {
      shell: resolved.shell,
      cwd: options.cwd,
      env: codeToolEnvironment(options.env),
      signal,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 4_000_000) controller.abort();
      options.onOutput?.(chunk.toString());
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errorOutput = (errorOutput + chunk.toString()).slice(-8_000);
      options.onOutput?.(chunk.toString());
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== null && (options.acceptedExitCodes ?? [0]).includes(code)) resolve(output);
      else
        reject(
          new Error(
            signal.aborted
              ? "Operation cancelled or timed out."
              : `${command} exited with ${code}: ${errorOutput || output.slice(-2_000)}`,
          ),
        );
    });
  });
}
