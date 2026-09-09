import {
  SecretsError,
  secretTargetId,
  type SecretApprovalInput,
  type SecretMetadata,
  type SecretReadRequest,
  type SecretThreadGrant,
  type ThreadId,
} from "@t3tools/contracts";
import { Context, Crypto, Deferred, Effect, Layer, SubscriptionRef } from "effect";

export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const state = yield* SubscriptionRef.make<{
    readonly pendingReads: ReadonlyArray<SecretReadRequest>;
    readonly threadGrants: ReadonlyArray<SecretThreadGrant>;
  }>({ pendingReads: [], threadGrants: [] });
  const pending = new Map<
    string,
    {
      request: SecretReadRequest;
      secret: SecretMetadata;
      result: Deferred.Deferred<void, SecretsError>;
    }
  >();
  const grants = new Map<string, SecretThreadGrant>();
  const grantId = (secret: SecretMetadata, threadId: ThreadId) =>
    JSON.stringify([threadId, secretTargetId(secret), secret.revision]);
  const refresh = Effect.fn("SecretApprovals.refresh")(function* () {
    yield* SubscriptionRef.set(state, {
      pendingReads: Array.from(pending.values(), ({ request }) => request),
      threadGrants: Array.from(grants.values()),
    });
  });
  const requireApproval = Effect.fn("SecretApprovals.requireApproval")(function* (
    secret: SecretMetadata,
    threadId: ThreadId,
    reason: string,
  ) {
    if (grants.has(grantId(secret, threadId))) return;
    const requestId = yield* crypto.randomUUIDv4.pipe(
      Effect.mapError(() => new SecretsError({ code: "unavailable" })),
    );
    const result = yield* Deferred.make<void, SecretsError>();
    const request: SecretReadRequest = {
      requestId,
      key: secret.key,
      scope: secret.scope,
      threadId,
      reason,
    };
    yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        if (pending.size >= 100) return false;
        pending.set(requestId, { request, secret, result });
        return true;
      }).pipe(
        Effect.flatMap((accepted) =>
          accepted ? Effect.void : Effect.fail(new SecretsError({ code: "capacity" })),
        ),
      ),
      () => refresh().pipe(Effect.andThen(Deferred.await(result))),
      () =>
        Effect.sync(() => pending.delete(requestId)).pipe(
          Effect.flatMap((removed) => (removed ? refresh() : Effect.void)),
        ),
    );
  });
  const respond = Effect.fn("SecretApprovals.respond")(function* (input: SecretApprovalInput) {
    const entry = pending.get(input.requestId);
    if (!entry) return yield* new SecretsError({ code: "not_found" });
    if (input.decision === "thread" && grants.size >= 1_024)
      return yield* new SecretsError({ code: "capacity" });
    const approvedGrantId = grantId(entry.secret, entry.request.threadId);
    if (input.decision === "thread") {
      grants.set(grantId(entry.secret, entry.request.threadId), {
        ...entry.secret,
        threadId: entry.request.threadId,
      });
    }
    const resolving =
      input.decision === "thread"
        ? Array.from(pending.values()).filter(
            (request) => grantId(request.secret, request.request.threadId) === approvedGrantId,
          )
        : [entry];
    for (const request of resolving) pending.delete(request.request.requestId);
    for (const request of resolving) {
      yield* input.decision === "deny"
        ? Deferred.fail(request.result, new SecretsError({ code: "denied" }))
        : Deferred.succeed(request.result, undefined);
    }
    yield* refresh();
  }, Effect.uninterruptible);
  const revokeThread = Effect.fn("SecretApprovals.revokeThread")(function* (threadId: ThreadId) {
    for (const [id, grant] of grants) if (grant.threadId === threadId) grants.delete(id);
    yield* refresh();
  });
  const invalidate = Effect.fn("SecretApprovals.invalidate")(function* (secret: SecretMetadata) {
    for (const [id, grant] of grants)
      if (secretTargetId(grant) === secretTargetId(secret)) grants.delete(id);
    for (const [id, entry] of pending) {
      if (secretTargetId(entry.secret) !== secretTargetId(secret)) continue;
      pending.delete(id);
      yield* Deferred.fail(entry.result, new SecretsError({ code: "conflict" }));
    }
    yield* refresh();
  });
  // Approval grants last only for this server lifetime; pending calls fail closed on restart.
  yield* Effect.addFinalizer(() =>
    Effect.forEach(
      pending.values(),
      (entry) => Deferred.fail(entry.result, new SecretsError({ code: "denied" })),
      { discard: true },
    ),
  );
  return {
    requireApproval,
    respond,
    revokeThread,
    invalidate,
    changes: SubscriptionRef.changes(state),
  };
});

export class SecretApprovals extends Context.Service<
  SecretApprovals,
  Effect.Success<typeof make>
>()("t3/secrets/SecretApprovals") {}
export const layer = Layer.effect(SecretApprovals, make);
