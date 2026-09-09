import { Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderServiceLive } from "../Layers/ProviderService.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderSessionDirectoryLive } from "../Layers/ProviderSessionDirectory.ts";
import { makeAdapterRegistryMock } from "./providerAdapterRegistryMock.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import type { ProviderAdapterError } from "../Errors.ts";
import * as ProviderSessionRuntime from "../../persistence/ProviderSessionRuntime.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as AnalyticsService from "../../telemetry/AnalyticsService.ts";
import { NoOpProviderEventLoggers, ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";

/** Uses the real event broadcaster, including for queue-backed provider adapters. */
export function providerServiceTestLayer(adapter: ProviderAdapterShape<ProviderAdapterError>) {
  return ProviderServiceLive.pipe(
    Layer.provideMerge(
      Layer.succeed(
        ProviderAdapterRegistry,
        makeAdapterRegistryMock({ [adapter.provider]: adapter }),
      ),
    ),
    Layer.provide(
      ProviderSessionDirectoryLive.pipe(
        Layer.provide(ProviderSessionRuntime.layer),
        Layer.provide(SqlitePersistenceMemory),
      ),
    ),
    Layer.provide(ServerSettingsService.layerTest()),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-advisor-runner-" })),
    Layer.provide(AnalyticsService.layerTest),
    Layer.provide(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
    Layer.provide(NodeServices.layer),
  );
}
