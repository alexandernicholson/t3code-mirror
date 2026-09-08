import {
  SecretMetadata,
  SecretValue,
  SecretsError,
  secretTargetId,
  type SecretTarget,
} from "@t3tools/contracts";
import { Context, Effect, Layer, Option, Schema, Semaphore } from "effect";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";

export const StoredSecret = Schema.Struct({ ...SecretMetadata.fields, value: SecretValue });
export type StoredSecret = typeof StoredSecret.Type;

/** Metadata reads must not require unlocking a vault or returning secret values. */
export class SecretReader extends Context.Service<
  SecretReader,
  {
    readonly list: Effect.Effect<ReadonlyArray<SecretMetadata>, SecretsError>;
    readonly read: (target: SecretTarget, revision: string) => Effect.Effect<string, SecretsError>;
  }
>()("t3/secrets/SecretBackend/SecretReader") {}

/** Separate from reads so a future vault integration can be read-only. */
export class SecretWriter extends Context.Service<
  SecretWriter,
  {
    readonly put: (
      secret: StoredSecret,
      expectedRevision: string | null,
    ) => Effect.Effect<void, SecretsError>;
    readonly remove: (target: SecretTarget, revision: string) => Effect.Effect<void, SecretsError>;
  }
>()("t3/secrets/SecretBackend/SecretWriter") {}

export const metadataOf = ({ value: _value, ...metadata }: StoredSecret): SecretMetadata =>
  metadata;

const Document = Schema.fromJsonString(Schema.Array(StoredSecret));
const decode = Schema.decodeUnknownEffect(Document);
const encode = Schema.encodeEffect(Document);
const unavailable = () => new SecretsError({ code: "unavailable" });

/** One atomic document keeps values and access policy consistent across crashes. */
export const localBackendLayer = Layer.unwrap(
  Effect.gen(function* () {
    const store = yield* ServerSecretStore;
    const mutex = yield* Semaphore.make(1);
    const load = store.get("agent-secrets-v1").pipe(
      Effect.mapError(unavailable),
      Effect.flatMap((bytes) =>
        Option.isSome(bytes)
          ? decode(new TextDecoder().decode(bytes.value)).pipe(Effect.mapError(unavailable))
          : Effect.succeed([] as ReadonlyArray<StoredSecret>),
      ),
    );
    const save = Effect.fn("SecretBackend.save")(function* (entries: ReadonlyArray<StoredSecret>) {
      const json = yield* encode(entries).pipe(Effect.mapError(unavailable));
      yield* store
        .set("agent-secrets-v1", new TextEncoder().encode(json))
        .pipe(Effect.mapError(unavailable));
    });
    const reader = SecretReader.of({
      list: load.pipe(Effect.map((entries) => entries.map(metadataOf))),
      read: Effect.fn("SecretBackend.read")(function* (target, revision) {
        const entry = (yield* load).find(
          (entry) => secretTargetId(entry) === secretTargetId(target),
        );
        if (!entry) return yield* new SecretsError({ code: "not_found" });
        if (entry.revision !== revision) return yield* new SecretsError({ code: "conflict" });
        return entry.value;
      }),
    });
    const writer = SecretWriter.of({
      put: Effect.fn("SecretBackend.put")(function* (secret, expectedRevision) {
        const entries = yield* load;
        const previous = entries.find((entry) => secretTargetId(entry) === secretTargetId(secret));
        if ((previous?.revision ?? null) !== expectedRevision)
          return yield* new SecretsError({ code: "conflict" });
        if (!previous && entries.length >= 256)
          return yield* new SecretsError({ code: "capacity" });
        yield* save([
          ...entries.filter((entry) => secretTargetId(entry) !== secretTargetId(secret)),
          secret,
        ]);
      }, mutex.withPermits(1)),
      remove: Effect.fn("SecretBackend.remove")(function* (target, revision) {
        const entries = yield* load;
        const previous = entries.find((entry) => secretTargetId(entry) === secretTargetId(target));
        if (!previous) return yield* new SecretsError({ code: "not_found" });
        if (previous.revision !== revision) return yield* new SecretsError({ code: "conflict" });
        yield* save(entries.filter((entry) => secretTargetId(entry) !== secretTargetId(target)));
      }, mutex.withPermits(1)),
    });
    return Layer.merge(Layer.succeed(SecretReader, reader), Layer.succeed(SecretWriter, writer));
  }),
);
