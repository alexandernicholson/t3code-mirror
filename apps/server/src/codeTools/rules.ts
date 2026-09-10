// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - User regex evaluation has a separately terminable worker deadline.
import * as NodeWorkerThreads from "node:worker_threads";
import * as NodePath from "node:path";
import { Schema } from "effect";
import { CodeRulesFile, type CodeCheckRule, type CodeDiagnostic } from "@t3tools/contracts";
import { readSource, workspaceFile } from "./workspace.ts";
import { languageServers } from "./catalog.ts";
import type { LanguageServerInstaller } from "./installer.ts";
import { runCommand } from "./process.ts";

const decodeRules = Schema.decodeUnknownSync(Schema.fromJsonString(CodeRulesFile));
const decodeWorkerReply = Schema.decodeUnknownSync(
  Schema.Union([
    Schema.Struct({ positions: Schema.Unknown }),
    Schema.Struct({ error: Schema.String }),
  ]),
);
const AstMatches = Schema.Array(
  Schema.Struct({
    range: Schema.Struct({ start: Schema.Struct({ line: Schema.Int, column: Schema.Int }) }),
  }),
);
const decodeAst = Schema.decodeUnknownSync(Schema.fromJsonString(AstMatches));
const decodePositions = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ line: Schema.Int, character: Schema.Int })),
);

/** User regexes run off the event loop and can be terminated independently. */
export function regexPositions(
  pattern: string,
  text: string,
): Promise<{ line: number; character: number }[]> {
  return new Promise((resolve, reject) => {
    const worker = new NodeWorkerThreads.Worker(
      `
      const { parentPort, workerData } = require('node:worker_threads');
      try {
        const regex = new RegExp(workerData.pattern, 'gm');
        const positions = [];
        for (const match of workerData.text.matchAll(regex)) {
          const prefix = workerData.text.slice(0, match.index);
          const line = prefix.split('\\n').length;
          positions.push({ line, character: match.index - prefix.lastIndexOf('\\n') });
          if (positions.length >= 100) break;
        }
        parentPort.postMessage({ positions });
      } catch (error) { parentPort.postMessage({ error: String(error.message) }); }
    `,
      { eval: true, workerData: { pattern, text }, resourceLimits: { maxOldGenerationSizeMb: 32 } },
    );
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error("A configured regex exceeded its execution limit. Simplify the rule."));
    }, 1_000);
    worker.once("message", (value: unknown) => {
      clearTimeout(timeout);
      void worker.terminate();
      try {
        const response = decodeWorkerReply(value);
        if ("error" in response) reject(new Error(response.error));
        else resolve([...decodePositions(response.positions)]);
      } catch (error) {
        reject(error);
      }
    });
    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
export async function loadCodeRules(root: string, file: string): Promise<readonly CodeCheckRule[]> {
  if (!file) return [];
  return decodeRules(await readSource(await workspaceFile(root, file))).rules;
}
export async function evaluateRules(input: {
  root: string;
  file: string;
  rules: readonly CodeCheckRule[];
  diagnostics: readonly CodeDiagnostic[];
  installer: LanguageServerInstaller;
  automaticInstall: boolean;
}): Promise<CodeDiagnostic[]> {
  const file = await workspaceFile(input.root, input.file);
  const relative = NodePath.relative(input.root, file).split(NodePath.sep).join("/");
  const matches: CodeDiagnostic[] = [];
  for (const rule of input.rules) {
    if (rule.files?.length && !rule.files.some((glob) => NodePath.matchesGlob(relative, glob)))
      continue;
    if (rule.match.type === "diagnostic") {
      const match = rule.match;
      matches.push(
        ...input.diagnostics
          .filter(
            (diagnostic) =>
              (!match.source || diagnostic.source === match.source) &&
              (!match.codes?.length || match.codes.includes(diagnostic.code)),
          )
          .map((diagnostic) => ({
            ...diagnostic,
            severity: rule.severity,
            guidance: `[${rule.id}] ${rule.message}`,
          })),
      );
      continue;
    }
    let positions: { line: number; character: number }[];
    if (rule.match.type === "regex")
      positions = await regexPositions(rule.match.pattern, await readSource(file));
    else {
      const definition = languageServers.find((server) => server.id === "ast-grep")!;
      let launch = await input.installer.resolve(definition, input.root);
      if (!launch && input.automaticInstall) {
        await input.installer.install(definition);
        launch = await input.installer.resolve(definition, input.root);
      }
      if (!launch) throw new Error("Install ast-grep in Code tools to run structural rules.");
      const output = await runCommand(
        launch.command,
        [
          ...launch.args,
          "run",
          "--json=compact",
          "--lang",
          rule.match.language,
          "--pattern",
          rule.match.pattern,
          file,
        ],
        { cwd: input.root, env: launch.env, timeoutMs: 10_000, acceptedExitCodes: [0, 1] },
      );
      positions = decodeAst(output)
        .slice(0, 100)
        .map((match) => ({
          line: match.range.start.line + 1,
          character: match.range.start.column + 1,
        }));
    }
    matches.push(
      ...positions.map((position) => ({
        file: relative,
        ...position,
        source: "rule",
        code: rule.id,
        severity: rule.severity,
        message: rule.message,
      })),
    );
  }
  return matches;
}

/** Diagnostic rules annotate the original issue, rather than adding a second card for it. */
export function combineDiagnostics(
  base: readonly CodeDiagnostic[],
  rules: readonly CodeDiagnostic[],
): CodeDiagnostic[] {
  const key = (value: CodeDiagnostic) =>
    JSON.stringify([
      value.file,
      value.line,
      value.character,
      value.source,
      value.code,
      value.message,
    ]);
  const originals = new Map(base.map((value) => [key(value), value]));
  const result = new Map(originals);
  for (const rule of rules) {
    const id = key(rule);
    const previous = result.get(id);
    result.set(
      id,
      previous?.guidance
        ? { ...rule, guidance: `${previous.guidance}\n${rule.guidance ?? ""}`.trim() }
        : rule,
    );
  }
  return [...result.values()];
}
