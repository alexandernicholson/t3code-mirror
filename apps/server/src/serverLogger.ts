import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import * as Layer from "effect/Layer";

import { ServerConfig } from "./config.ts";
import * as ResourceAttribution from "./resourceTelemetry/ResourceAttribution.ts";
import { makeServerLogStore } from "./serverLog.ts";

export const ServerLoggerLive = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const attribution = yield* ResourceAttribution.ResourceAttribution;
  const serverLogWriter = yield* makeServerLogStore(config, attribution);
  const minimumLogLevelLayer = Layer.succeed(References.MinimumLogLevel, config.logLevel);
  const loggerLayer = Logger.layer(
    [
      Logger.consolePretty(),
      Logger.tracerLogger,
      ...(serverLogWriter.logger === undefined ? [] : [serverLogWriter.logger]),
    ],
    {
      mergeWithExisting: false,
    },
  );

  return Layer.mergeAll(loggerLayer, minimumLogLevelLayer);
}).pipe(Layer.unwrap);
