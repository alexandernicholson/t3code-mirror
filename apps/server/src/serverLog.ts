// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalDateInEffect:off tryCatchInEffectGen:off -- The bounded sync sink uses wall-clock file metadata and catches filesystem failures at the logging boundary.
import * as NodeFS from "node:fs";

import type {
  ServerLogDiagnosticsResult,
  ServerLogEntry,
  ServerLogTailInput,
  ServerLogTailResult,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Scope from "effect/Scope";

import { RotatingFileSink } from "@t3tools/shared/logging";
import { causeErrorTag } from "@t3tools/shared/observability";

import * as ServerConfig from "./config.ts";
import type * as ResourceAttribution from "./resourceTelemetry/ResourceAttribution.ts";

const DEFAULT_TAIL_BYTES = 64 * 1024;
const MAX_TAIL_BYTES = 64 * 1024;
const DEFAULT_TAIL_ENTRIES = 200;
const MAX_TAIL_ENTRIES = 200;
const MAX_VALUE_DEPTH = 4;
const MAX_OBJECT_KEYS = 32;
const MAX_ARRAY_ENTRIES = 32;
const MAX_STRING_LENGTH = 2_048;
const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";

const SENSITIVE_KEY_PATTERN =
  /(?:access[_-]?token|api[_-]?key|authorization|cookie|credential|password|private[_-]?key|refresh[_-]?token|secret|token)/iu;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+\-/]+=*/giu;
const LABELED_SECRET_PATTERN =
  /((?:access[_-]?token|api[_-]?key|authorization|cookie|password|private[_-]?key|refresh[_-]?token|secret|token)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/giu;

interface ServerLogFile {
  readonly filePath: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly active: boolean;
}

interface MutableStats {
  droppedRecordCount: number;
  writeFailureCount: number;
  lastWriteAtMs: number | undefined;
  enabled: boolean;
}

interface PendingRecord {
  readonly line: string;
  readonly bytes: number;
  readonly highPriority: boolean;
}

interface PendingAttribution {
  logicalWriteBytes: number;
  count: number;
  durationMs: number;
}

export interface ServerLogWriter {
  readonly logger: Logger.Logger<unknown, void> | undefined;
}

interface ServerLogReaders {
  readonly readDiagnostics: Effect.Effect<ServerLogDiagnosticsResult>;
  readonly readTail: (input: ServerLogTailInput) => Effect.Effect<ServerLogTailResult>;
}

const readersByPath = new Map<string, ServerLogReaders>();

function errorSummary(cause: unknown): string {
  if (cause instanceof Error) return cause.name;
  return typeof cause;
}

function reportFileFailure(filePath: string, operation: string, cause: unknown): void {
  const message = `[t3] server log ${operation} failed for ${filePath} (${errorSummary(cause)})\n`;
  try {
    process.stderr.write(message);
  } catch {
    // Logging must never make the server fail while reporting a logging error.
  }
}

function truncateString(value: string, maxLength = MAX_STRING_LENGTH): string {
  const redacted = value
    .replace(BEARER_PATTERN, "Bearer ${REDACTED}")
    .replace(LABELED_SECRET_PATTERN, `$1${REDACTED}`);
  return redacted.length <= maxLength
    ? redacted
    : `${redacted.slice(0, Math.max(0, maxLength - TRUNCATED.length - 1))}…${TRUNCATED}`;
}

function isSensitiveKey(key: string | undefined): boolean {
  return key !== undefined && SENSITIVE_KEY_PATTERN.test(key);
}

function sanitizeUnknown(
  value: unknown,
  key: string | undefined,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (isSensitiveKey(key)) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncateString(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "bigint") return String(value);
  if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
  if (depth >= MAX_VALUE_DEPTH) return TRUNCATED;
  if (typeof value !== "object") return truncateString(String(value));
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: truncateString(value.name),
      message: truncateString(value.message),
    };
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ENTRIES)
      .map((entry) => sanitizeUnknown(entry, undefined, depth + 1, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    result[entryKey] = sanitizeUnknown(entryValue, entryKey, depth + 1, seen);
  }
  return result;
}

function formatMessage(value: unknown): string {
  if (Array.isArray(value)) {
    const messages = value.map((entry) => formatMessage(entry)).filter((entry) => entry.length > 0);
    return messages.join(" ") || "(empty log message)";
  }
  if (typeof value === "string") return truncateString(value);
  const sanitized = sanitizeUnknown(value, undefined, 0, new WeakSet());
  if (typeof sanitized === "string") return sanitized;
  try {
    return truncateString(JSON.stringify(sanitized) ?? String(sanitized));
  } catch {
    return "[UNSERIALIZABLE]";
  }
}

function logLevelPriority(level: string): boolean {
  return level === "Warning" || level === "Error" || level === "Fatal";
}

function rotatedPaths(filePath: string, maxFiles: number): ReadonlyArray<string> {
  return [
    filePath,
    ...Array.from(
      { length: Math.max(0, Math.floor(maxFiles)) },
      (_, index) => `${filePath}.${index + 1}`,
    ),
  ];
}

function listExistingFiles(filePath: string, maxFiles: number): ReadonlyArray<ServerLogFile> {
  const files: Array<ServerLogFile> = [];
  for (const [index, candidate] of rotatedPaths(filePath, maxFiles).entries()) {
    try {
      const stat = NodeFS.statSync(candidate);
      if (!stat.isFile()) continue;
      files.push({
        filePath: candidate,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        active: index === 0,
      });
    } catch (cause) {
      // Diagnostics reports read failures through its bounded response; it must
      // not turn a repeated RPC refresh into an unbounded stderr stream.
      void cause;
    }
  }
  return files;
}

function enforceRetention(
  filePath: string,
  config: ServerConfig.ServerLogConfig,
  nowMs: number,
): void {
  const files = listExistingFiles(filePath, config.maxFiles);
  let totalBytes = files.reduce((total, file) => total + file.size, 0);
  const removable = files
    .filter((file) => !file.active)
    .toSorted(
      (left, right) => left.mtimeMs - right.mtimeMs || left.filePath.localeCompare(right.filePath),
    );

  const remove = (file: ServerLogFile): void => {
    try {
      NodeFS.rmSync(file.filePath, { force: true });
      totalBytes -= file.size;
    } catch (cause) {
      reportFileFailure(file.filePath, "remove", cause);
    }
  };

  for (const file of removable) {
    if (nowMs - file.mtimeMs > config.maxAgeMs) remove(file);
  }
  for (const file of removable) {
    if (totalBytes <= config.maxTotalBytes) break;
    if (NodeFS.existsSync(file.filePath)) remove(file);
  }
}

function parseTimestamp(value: unknown, fallback: DateTime.Utc): DateTime.Utc {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  return Option.getOrElse(DateTime.make(value), () => fallback);
}

interface ParsedLogEntry {
  readonly entry: ServerLogEntry;
  readonly parseError: boolean;
}

function parseEntry(line: string, fallback: DateTime.Utc): ParsedLogEntry {
  const trimmed = line.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        const level = typeof record.level === "string" ? truncateString(record.level, 64) : "Info";
        const message = formatMessage(record.message ?? record.msg ?? trimmed);
        const causeTag =
          typeof record.causeTag === "string" ? truncateString(record.causeTag, 128) : undefined;
        return {
          entry: {
            timestamp: parseTimestamp(record.timestamp, fallback),
            level,
            message,
            ...(causeTag ? { causeTag } : {}),
          },
          parseError: false,
        };
      }
    } catch {
      // Keep the line visible while reporting that the structured record was malformed.
      return {
        entry: {
          timestamp: fallback,
          level: "Info",
          message: truncateString(trimmed || "(empty log message)"),
        },
        parseError: true,
      };
    }
  }

  return {
    entry: {
      timestamp: fallback,
      level: "Info",
      message: truncateString(trimmed || "(empty log message)"),
    },
    parseError: false,
  };
}

function readTailBytes(
  filePath: string,
  maxBytes: number,
): {
  readonly text: string;
  readonly bytesRead: number;
  readonly truncated: boolean;
} {
  const stat = NodeFS.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  const descriptor = NodeFS.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = NodeFS.readSync(descriptor, buffer, 0, length, start);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline < 0 ? "" : text.slice(firstNewline + 1);
    }
    return { text, bytesRead, truncated: start > 0 };
  } finally {
    NodeFS.closeSync(descriptor);
  }
}

function emptyError(kind: "server-log-not-found" | "server-log-read-failed", message: string) {
  return { kind, message } as const;
}

function makeReadError(kind: "server-log-not-found" | "server-log-read-failed", message: string) {
  return Option.some(emptyError(kind, message));
}

export const makeServerLogStore = Effect.fn("makeServerLogStore")(function* (
  config: ServerConfig.ServerConfig["Service"],
  attribution?: ResourceAttribution.ResourceAttribution["Service"],
): Effect.fn.Return<ServerLogWriter, never, Scope.Scope> {
  const logConfig = config.serverLog ?? ServerConfig.DEFAULT_SERVER_LOG_CONFIG;
  let sink: RotatingFileSink | undefined;
  const stats: MutableStats = {
    droppedRecordCount: 0,
    writeFailureCount: 0,
    lastWriteAtMs: undefined,
    enabled: true,
  };
  let failureReported = false;
  let closed = false;
  let pendingBytes = 0;
  let pending: Array<PendingRecord> = [];
  let pendingAttribution: PendingAttribution = {
    logicalWriteBytes: 0,
    count: 0,
    durationMs: 0,
  };

  const reportFailure = (operation: string, cause: unknown): void => {
    stats.writeFailureCount += 1;
    stats.enabled = false;
    if (!failureReported) {
      failureReported = true;
      reportFileFailure(config.serverLogPath, operation, cause);
    }
  };

  try {
    sink = new RotatingFileSink({
      filePath: config.serverLogPath,
      maxBytes: logConfig.maxBytes,
      maxFiles: logConfig.maxFiles,
      fileMode: 0o600,
      throwOnError: true,
    });
    enforceRetention(config.serverLogPath, logConfig, Date.now());
  } catch (cause) {
    reportFailure("initialize", cause);
  }

  const flushUnsafe = (): void => {
    if (pending.length === 0) return;
    const records = pending;
    pending = [];
    pendingBytes = 0;
    if (sink === undefined || !stats.enabled) {
      stats.droppedRecordCount += records.length;
      return;
    }

    try {
      let chunk: Array<PendingRecord> = [];
      let chunkBytes = 0;
      const writeChunk = (): void => {
        if (chunk.length === 0) return;
        const startedAt = performance.now();
        sink?.write(chunk.map((record) => record.line).join(""));
        pendingAttribution = {
          logicalWriteBytes: pendingAttribution.logicalWriteBytes + chunkBytes,
          count: pendingAttribution.count + chunk.length,
          durationMs: pendingAttribution.durationMs + Math.max(0, performance.now() - startedAt),
        };
        chunk = [];
        chunkBytes = 0;
      };
      for (const record of records) {
        if (chunkBytes > 0 && chunkBytes + record.bytes > logConfig.maxWriteChunkBytes) {
          writeChunk();
        }
        chunk.push(record);
        chunkBytes += record.bytes;
      }
      writeChunk();
      stats.lastWriteAtMs = Date.now();
    } catch (cause) {
      reportFailure("write", cause);
      stats.droppedRecordCount += records.length;
    }
  };

  const enqueue = (record: PendingRecord): void => {
    if (closed || sink === undefined || !stats.enabled) {
      stats.droppedRecordCount += 1;
      return;
    }

    while (
      pending.length >= logConfig.maxBufferedRecords ||
      pendingBytes + record.bytes > logConfig.maxBufferedBytes
    ) {
      const dropIndex = pending.findIndex((pendingRecord) => !pendingRecord.highPriority);
      if (dropIndex >= 0) {
        const [dropped] = pending.splice(dropIndex, 1);
        pendingBytes -= dropped?.bytes ?? 0;
        stats.droppedRecordCount += 1;
        continue;
      }
      if (!record.highPriority) {
        stats.droppedRecordCount += 1;
        return;
      }
      flushUnsafe();
      if (!stats.enabled) return;
      if (
        pending.length >= logConfig.maxBufferedRecords ||
        pendingBytes + record.bytes > logConfig.maxBufferedBytes
      ) {
        stats.droppedRecordCount += 1;
        return;
      }
    }

    pending.push(record);
    pendingBytes += record.bytes;
    if (
      pending.length >= logConfig.maxBufferedRecords ||
      pendingBytes >= logConfig.maxBufferedBytes
    ) {
      flushUnsafe();
    }
  };

  const flush = Effect.gen(function* () {
    yield* Effect.sync(flushUnsafe);
    if (attribution !== undefined && pendingAttribution.count > 0) {
      const current = pendingAttribution;
      pendingAttribution = { logicalWriteBytes: 0, count: 0, durationMs: 0 };
      yield* attribution.record({
        component: "server-log",
        operation: "append",
        logicalWriteBytes: current.logicalWriteBytes,
        count: current.count,
        durationMs: current.durationMs,
      });
    }
  });
  const maintain = Effect.gen(function* () {
    yield* flush;
    if (sink !== undefined && stats.enabled) {
      yield* Effect.try({
        try: () => enforceRetention(config.serverLogPath, logConfig, Date.now()),
        catch: (cause) => {
          reportFailure("retention", cause);
          return undefined;
        },
      });
    }
  });

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      closed = true;
      yield* flush;
    }).pipe(Effect.ignore),
  );
  yield* Effect.forkScoped(
    Effect.sleep(`${logConfig.batchWindowMs} millis`).pipe(Effect.andThen(flush), Effect.forever),
  );
  yield* Effect.forkScoped(
    Effect.sleep(`${logConfig.retentionCheckIntervalMs} millis`).pipe(
      Effect.andThen(maintain),
      Effect.forever,
    ),
  );

  const logger =
    sink === undefined
      ? undefined
      : Logger.make<unknown, void>((options) => {
          const level = String(options.logLevel);
          const annotations = options.fiber.getRef(References.CurrentLogAnnotations);
          const cause = options.cause.reasons.length > 0 ? causeErrorTag(options.cause) : undefined;
          const record = {
            timestamp: options.date.toISOString(),
            level,
            message: formatMessage(options.message),
            ...(cause ? { causeTag: cause } : {}),
            ...(Object.keys(annotations).length > 0
              ? {
                  attributes: sanitizeUnknown(annotations, undefined, 0, new WeakSet()),
                }
              : {}),
          };
          let line: string;
          try {
            line = `${JSON.stringify(record)}\n`;
          } catch {
            line = `${JSON.stringify({
              timestamp: options.date.toISOString(),
              level,
              message: "[UNSERIALIZABLE LOG RECORD]",
            })}\n`;
          }
          if (Buffer.byteLength(line) > logConfig.maxRecordBytes) {
            line = `${JSON.stringify({
              timestamp: options.date.toISOString(),
              level,
              message: truncateString(formatMessage(options.message), 1_024),
              ...(cause ? { causeTag: cause } : {}),
              truncated: true,
            })}\n`;
          }
          enqueue({
            line,
            bytes: Buffer.byteLength(line),
            highPriority: logLevelPriority(level),
          });
        });

  const readDiagnostics: ServerLogReaders["readDiagnostics"] = Effect.gen(function* () {
    const readAt = yield* DateTime.now;
    const files = listExistingFiles(config.serverLogPath, logConfig.maxFiles);
    const lastMtime = files.reduce<number | undefined>(
      (latest, file) => Math.max(latest ?? 0, file.mtimeMs),
      stats.lastWriteAtMs,
    );
    const lastWriteAt = lastMtime === undefined ? Option.none() : DateTime.make(lastMtime);
    return {
      logFilePath: config.serverLogPath,
      scannedFilePaths: files.map((file) => file.filePath),
      readAt,
      enabled: stats.enabled,
      activeFileBytes: files.find((file) => file.active)?.size ?? 0,
      totalFileBytes: files.reduce((total, file) => total + file.size, 0),
      retainedFileCount: files.length,
      droppedRecordCount: stats.droppedRecordCount,
      writeFailureCount: stats.writeFailureCount,
      lastWriteAt,
      partialFailure: Option.none(),
      error:
        files.length === 0
          ? makeReadError("server-log-not-found", "No server log files have been written yet.")
          : Option.none(),
    } satisfies ServerLogDiagnosticsResult;
  });

  const readTail: ServerLogReaders["readTail"] = (input) =>
    Effect.gen(function* () {
      const readAt = yield* DateTime.now;
      const maxBytes = Math.max(1, Math.min(input.maxBytes ?? DEFAULT_TAIL_BYTES, MAX_TAIL_BYTES));
      const maxEntries = Math.max(
        1,
        Math.min(input.maxEntries ?? DEFAULT_TAIL_ENTRIES, MAX_TAIL_ENTRIES),
      );
      const fragments: Array<{ entries: Array<ServerLogEntry> }> = [];
      const scannedFilePaths: Array<string> = [];
      let bytesRead = 0;
      let parseErrorCount = 0;
      let truncated = false;
      let readFailure: { kind: "server-log-read-failed"; message: string } | undefined;

      for (const file of rotatedPaths(config.serverLogPath, logConfig.maxFiles)) {
        if (
          bytesRead >= maxBytes ||
          fragments.flatMap((fragment) => fragment.entries).length >= maxEntries
        ) {
          truncated = true;
          break;
        }
        try {
          const tail = readTailBytes(file, Math.max(1, maxBytes - bytesRead));
          bytesRead += tail.bytesRead;
          truncated ||= tail.truncated;
          scannedFilePaths.push(file);
          const entries: Array<ServerLogEntry> = [];
          for (const line of tail.text.split(/\r?\n/u)) {
            if (line.trim().length === 0) continue;
            const parsed = parseEntry(line, readAt);
            if (parsed.parseError) parseErrorCount += 1;
            entries.push(parsed.entry);
          }
          if (entries.length > 0) fragments.push({ entries });
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
            readFailure ??= {
              kind: "server-log-read-failed",
              message: `Failed to read server log file '${file}'.`,
            };
            void cause;
          }
        }
      }

      const entries = fragments
        .toReversed()
        .flatMap((fragment) => fragment.entries)
        .slice(-maxEntries);
      return {
        logFilePath: config.serverLogPath,
        scannedFilePaths,
        readAt,
        entries,
        bytesRead,
        parseErrorCount,
        truncated: truncated || entries.length >= maxEntries,
        partialFailure: readFailure ? Option.some(true) : Option.none(),
        error: readFailure
          ? Option.some(readFailure)
          : entries.length === 0
            ? makeReadError("server-log-not-found", "No server log entries are available yet.")
            : Option.none(),
      } satisfies ServerLogTailResult;
    });

  const readers = { readDiagnostics, readTail } satisfies ServerLogReaders;
  readersByPath.set(config.serverLogPath, readers);
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      if (readersByPath.get(config.serverLogPath) === readers) {
        readersByPath.delete(config.serverLogPath);
      }
    }),
  );
  return { logger } satisfies ServerLogWriter;
});

export const readServerLogDiagnostics = (
  config: ServerConfig.ServerConfig["Service"],
): Effect.Effect<ServerLogDiagnosticsResult> => {
  const readers = readersByPath.get(config.serverLogPath);
  if (readers !== undefined) return readers.readDiagnostics;

  return Effect.gen(function* () {
    const readAt = yield* DateTime.now;
    const logConfig = config.serverLog ?? ServerConfig.DEFAULT_SERVER_LOG_CONFIG;
    const files = listExistingFiles(config.serverLogPath, logConfig.maxFiles);
    const lastMtime = files.reduce<number | undefined>(
      (latest, file) => Math.max(latest ?? 0, file.mtimeMs),
      undefined,
    );
    return {
      logFilePath: config.serverLogPath,
      scannedFilePaths: files.map((file) => file.filePath),
      readAt,
      enabled: false,
      activeFileBytes: files.find((file) => file.active)?.size ?? 0,
      totalFileBytes: files.reduce((total, file) => total + file.size, 0),
      retainedFileCount: files.length,
      droppedRecordCount: 0,
      writeFailureCount: 0,
      lastWriteAt: lastMtime === undefined ? Option.none() : DateTime.make(lastMtime),
      partialFailure: Option.none(),
      error:
        files.length === 0
          ? makeReadError("server-log-not-found", "No server log files have been written yet.")
          : Option.none(),
    } satisfies ServerLogDiagnosticsResult;
  });
};

export const readServerLogTail = (
  config: ServerConfig.ServerConfig["Service"],
  input: ServerLogTailInput,
): Effect.Effect<ServerLogTailResult> => {
  const readers = readersByPath.get(config.serverLogPath);
  if (readers !== undefined) return readers.readTail(input);

  return Effect.gen(function* () {
    const readAt = yield* DateTime.now;
    return {
      logFilePath: config.serverLogPath,
      scannedFilePaths: [],
      readAt,
      entries: [],
      bytesRead: 0,
      parseErrorCount: 0,
      truncated: false,
      partialFailure: Option.none(),
      error: makeReadError("server-log-not-found", "No server log entries are available yet."),
    } satisfies ServerLogTailResult;
  });
};
