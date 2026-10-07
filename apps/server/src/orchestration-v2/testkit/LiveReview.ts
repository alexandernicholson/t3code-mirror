import { ClaudeSettings, ProviderInstanceId } from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Claude from "../Adapters/ClaudeAdapterV2.ts";
import * as Registry from "../ProviderAdapterRegistry.ts";
import * as IdAllocator from "../IdAllocator.ts";
import * as ProviderEventLoggers from "../../provider/ProviderEventLoggers.ts";
import * as ServerConfig from "../../config.ts";

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const adapter = yield* Claude.createClaudeAdapterV2(
      {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        enabled: true,
        config: yield* Schema.decodeEffect(ClaudeSettings)({}),
        displayName: "Claude",
        environment: [],
      },
      {},
    );
    return Registry.layerFromAdapters([adapter]);
  }),
).pipe(
  Layer.provide(
    Claude.layerQueryRunner.pipe(
      Layer.provide(
        Layer.succeed(ProviderEventLoggers.ProviderEventLoggers, {
          native: undefined,
          canonical: undefined,
        }),
      ),
    ),
  ),
  Layer.provide(IdAllocator.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-live-review-" })),
  Layer.provide(NodeServices.layer),
);
