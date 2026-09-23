import { otlpSerializationLayer } from "@t3tools/shared/observability";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import * as OtlpExporter from "effect/unstable/observability/OtlpExporter";
import * as OtlpLogger from "effect/unstable/observability/OtlpLogger";

import { otlpResource, ServerConfig } from "./config.ts";
import * as ResourceAttribution from "./resourceTelemetry/ResourceAttribution.ts";
import { makeServerLogStore } from "./serverLog.ts";

export const ServerLoggerLive = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const attribution = yield* ResourceAttribution.ResourceAttribution;
  const serverLogWriter = yield* makeServerLogStore(config, attribution);
  const minimumLogLevelLayer = Layer.succeed(References.MinimumLogLevel, config.logLevel);
  const logs = config.otlpLogsExport;
  const otlpLogger =
    config.otlpLogsUrl === undefined
      ? undefined
      : OtlpLogger.make({
          url: config.otlpLogsUrl,
          exportInterval: `${logs.exportIntervalMs} millis`,
          headers: logs.headers,
          resource: otlpResource(config),
        });
  const loggerLayer = Logger.layer(
    [
      Logger.consolePretty(),
      otlpLogger ?? Logger.tracerLogger,
      ...(serverLogWriter.logger === undefined ? [] : [serverLogWriter.logger]),
    ],
    {
      mergeWithExisting: false,
    },
  ).pipe(
    Layer.provide(OtlpExporter.layerFlusher),
    Layer.provide(otlpSerializationLayer(logs.protocol)),
  );

  return Layer.mergeAll(loggerLayer, minimumLogLevelLayer);
}).pipe(Layer.unwrap);
