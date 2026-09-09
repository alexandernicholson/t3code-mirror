import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const ForkVersion = Schema.String.check(
  Schema.isPattern(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
);
const GitCommit = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/));
const SourceRuntimeVersion = Schema.String.check(
  Schema.isPattern(/^\d+\.\d+\.\d+\+git\.[a-f0-9]{40}$/),
);

export const SourceUpdatePolicy = Schema.Literals(["automatic", "manual-restart", "notify"]);
export type SourceUpdatePolicy = typeof SourceUpdatePolicy.Type;

export const SourceUpdateSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  branch: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("main"))),
  policy: SourceUpdatePolicy.pipe(Schema.withDecodingDefault(Effect.succeed("automatic"))),
}).pipe(Schema.withDecodingDefault(Effect.succeed({})));
export type SourceUpdateSettings = typeof SourceUpdateSettings.Type;

export const SourceUpdateSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  branch: Schema.optionalKey(Schema.String),
  policy: Schema.optionalKey(SourceUpdatePolicy),
});

const SourceBuildInfo = Schema.Struct({
  version: ForkVersion,
  runtimeVersion: SourceRuntimeVersion,
  commit: GitCommit,
  branch: Schema.String,
});

export const SourceBuild = Schema.Struct({
  ...SourceBuildInfo.fields,
  repository: Schema.String,
  migrations: Schema.Record(Schema.String, Schema.String),
});
export type SourceBuild = typeof SourceBuild.Type;

export const SourceUpdateTarget = Schema.Struct({
  version: ForkVersion,
  runtimeVersion: SourceRuntimeVersion,
  commit: GitCommit,
  branch: Schema.String,
  notes: Schema.String,
  divergent: Schema.Boolean,
  compareUrl: Schema.optionalKey(Schema.String),
});
export type SourceUpdateTarget = typeof SourceUpdateTarget.Type;

export const SourceUpdateStatus = Schema.Struct({
  installedNotes: Schema.optionalKey(Schema.String),
  deferred: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  restartRequested: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  supported: Schema.Boolean,
  running: Schema.NullOr(SourceBuildInfo),
  phase: Schema.Literals([
    "idle",
    "checking",
    "available",
    "building",
    "ready",
    "waiting",
    "restarting",
    "failed",
  ]),
  target: Schema.NullOr(SourceUpdateTarget),
  lastCheckedAt: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  updateId: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(Schema.Literals(["committed", "rolled-back", "failed"])),
});
export type SourceUpdateStatus = typeof SourceUpdateStatus.Type;

export const SourceUpdateAction = Schema.Struct({
  action: Schema.Literals(["check", "prepare", "restart", "discard"]),
  /** The UI's exact target; stale restart requests must never activate another build. */
  commit: Schema.optionalKey(GitCommit),
});
export type SourceUpdateAction = typeof SourceUpdateAction.Type;

export class SourceUpdateError extends Schema.TaggedError<SourceUpdateError>()(
  "SourceUpdateError",
  {
    message: Schema.String,
  },
) {}
