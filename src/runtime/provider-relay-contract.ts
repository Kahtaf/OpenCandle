export const PROVIDER_RELAY_CONTRACT_VERSION = 1 as const;
export const PROVIDER_RELAY_PATH = "/v1/provider-fetch";
export const MODEL_RELAY_PATH = "/v1/model-fetch";
export const PROVIDER_RELAY_HEALTH_PATH = "/v1/health";
export const PROVIDER_RELAY_RUNTIME_TOKEN_PATH = "/v1/runtime-token";

export const MODEL_RELAY_PROVIDER_IDS = ["anthropic", "google", "openai"] as const;
export type ModelRelayProvider = (typeof MODEL_RELAY_PROVIDER_IDS)[number];

export const MODEL_RELAY_HEADERS = Object.freeze({
  client: "x-opencandle-client",
  runtimeToken: "x-opencandle-runtime-token",
  provider: "x-opencandle-provider",
  upstreamMethod: "x-opencandle-upstream-method",
  upstreamUrl: "x-opencandle-upstream-url",
});

export function isModelRelayProvider(value: unknown): value is ModelRelayProvider {
  return (
    typeof value === "string" && MODEL_RELAY_PROVIDER_IDS.includes(value as ModelRelayProvider)
  );
}

export function modelRelayProviderForUrl(url: URL): ModelRelayProvider | undefined {
  switch (url.hostname) {
    case "api.anthropic.com":
      return "anthropic";
    case "generativelanguage.googleapis.com":
      return "google";
    case "api.openai.com":
      return "openai";
    default:
      return undefined;
  }
}
