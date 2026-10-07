import Constants from "expo-constants";
import * as RelayTracing from "@t3tools/shared/relayTracing";

export interface TracingConfig {
  readonly tracesUrl: string;
  readonly tracesDataset: string;
  readonly tracesToken: string;
}

export interface TracingResource {
  readonly serviceVersion?: string;
  readonly appVariant: string;
}

export function resolveTracingConfig(): TracingConfig | null {
  const extra = Constants.expoConfig?.extra;
  if (extra?.cloudEnabled !== true) return null;
  const value = extra?.observability;
  return typeof value?.tracesUrl === "string" &&
    value.tracesUrl.startsWith("https://") &&
    typeof value?.tracesDataset === "string" &&
    typeof value?.tracesToken === "string"
    ? {
        tracesUrl: value.tracesUrl,
        tracesDataset: value.tracesDataset,
        tracesToken: value.tracesToken,
      }
    : null;
}

export function layerFromConfig(config: TracingConfig | null, resource: TracingResource) {
  return RelayTracing.layer(config, {
    serviceName: "t3code-mobile",
    serviceVersion: resource.serviceVersion,
    runtime: "react-native",
    client: `mobile-${resource.appVariant}`,
  });
}

export const layer = layerFromConfig(resolveTracingConfig(), {
  serviceVersion: Constants.expoConfig?.version,
  appVariant:
    typeof Constants.expoConfig?.extra?.appVariant === "string"
      ? Constants.expoConfig.extra.appVariant
      : "unknown",
});
