import {
  SecretsError,
  secretTargetId,
  type SecretMetadata,
  type SecretTarget,
  type SecretUpdateInput,
  type SecretWriteInput,
  type ThreadId,
} from "@t3tools/contracts";
import { Context, Crypto, Effect, Layer, Semaphore, Stream, SubscriptionRef } from "effect";
import { SecretReader, SecretWriter } from "./SecretBackend.ts";
import { SecretApprovals } from "./SecretApprovals.ts";

export const make = Effect.gen(function* () {
  const reader = yield* SecretReader;
  const writer = yield* SecretWriter;
  const approvals = yield* SecretApprovals;
  const crypto = yield* Crypto.Crypto;
  const mutex = yield* Semaphore.make(1);
  const metadata = yield* SubscriptionRef.make(yield* reader.list);
  const refresh = reader.list.pipe(
    Effect.flatMap((entries) => SubscriptionRef.set(metadata, entries)),
  );
  const find = Effect.fn("Secrets.find")(function* (target: SecretTarget) {
    return (yield* reader.list).find((entry) => secretTargetId(entry) === secretTargetId(target));
  });
  const revision = crypto.randomUUIDv4.pipe(
    Effect.mapError(() => new SecretsError({ code: "unavailable" })),
  );
  const create = Effect.fn("Secrets.create")(
    function* (input: SecretWriteInput) {
      yield* writer.put({ ...input, revision: yield* revision }, null);
      yield* refresh;
    },
    Effect.uninterruptible,
    mutex.withPermits(1),
  );
  const update = Effect.fn("Secrets.update")(
    function* (input: SecretUpdateInput) {
      const value = input.value ?? (yield* reader.read(input, input.revision));
      yield* writer.put({ ...input, value, revision: yield* revision }, input.revision);
      yield* approvals.invalidate(input);
      yield* refresh;
    },
    Effect.uninterruptible,
    mutex.withPermits(1),
  );
  const remove = Effect.fn("Secrets.remove")(
    function* (target: SecretTarget & { readonly revision: string }) {
      yield* writer.remove(target, target.revision);
      yield* approvals.invalidate({ ...target, highlySensitive: true });
      yield* refresh;
    },
    Effect.uninterruptible,
    mutex.withPermits(1),
  );
  const readForAgent = Effect.fn("Secrets.readForAgent")(function* (
    target: SecretTarget,
    threadId: ThreadId,
    reason: string,
  ) {
    const entry = yield* find(target);
    if (!entry) return yield* new SecretsError({ code: "not_found" });
    if (entry.highlySensitive) yield* approvals.requireApproval(entry, threadId, reason);
    // Resolve only after approval, against the exact revision the user approved.
    return yield* reader.read(target, entry.revision);
  });
  const writeForAgent = Effect.fn("Secrets.writeForAgent")(
    function* (input: SecretWriteInput) {
      const previous = yield* find(input);
      const entry: SecretMetadata = {
        key: input.key,
        scope: input.scope,
        highlySensitive: input.highlySensitive || previous?.highlySensitive === true,
        revision: yield* revision,
      };
      yield* writer.put({ ...entry, value: input.value }, previous?.revision ?? null);
      if (previous) yield* approvals.invalidate(previous);
      yield* refresh;
      return entry;
    },
    Effect.uninterruptible,
    mutex.withPermits(1),
  );
  return {
    list: reader.list,
    create,
    update,
    remove,
    readForAgent,
    writeForAgent,
    respond: approvals.respond,
    revoke: ({ threadId }: { readonly threadId: ThreadId }) => approvals.revokeThread(threadId),
    changes: Stream.zipLatestWith(
      SubscriptionRef.changes(metadata),
      approvals.changes,
      (entries, access) => ({ entries, ...access }),
    ),
  };
});
export class Secrets extends Context.Service<Secrets, Effect.Success<typeof make>>()(
  "t3/secrets/Secrets",
) {}
export const layer = Layer.effect(Secrets, make);
