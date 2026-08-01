import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
  StreamOptions,
} from "@earendil-works/pi-ai";
import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
  modelsAreEqual,
} from "../../../node_modules/@earendil-works/pi-ai/dist/models.js";
import { cleanupSessionResources } from "../../../node_modules/@earendil-works/pi-ai/dist/session-resources.js";
import { isContextOverflow } from "../../../node_modules/@earendil-works/pi-ai/dist/utils/overflow.js";
import { isRetryableAssistantError } from "../../../node_modules/@earendil-works/pi-ai/dist/utils/retry.js";
import { createFirstClassModelProviders } from "../../../src/pi/model-provider-catalog.js";

const providers = new Map(
  createFirstClassModelProviders().map((provider) => [provider.id, provider]),
);

export {
  clampThinkingLevel,
  cleanupSessionResources,
  getSupportedThinkingLevels,
  isContextOverflow,
  isRetryableAssistantError,
  modelsAreEqual,
};

export function streamSimple(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) {
  const provider = providers.get(model.provider);
  if (!provider) throw new Error(`Unsupported hosted model provider: ${model.provider}`);
  return provider.streamSimple(model, context, options);
}

export function stream(model: Model<Api>, context: Context, options?: StreamOptions) {
  const provider = providers.get(model.provider);
  if (!provider) throw new Error(`Unsupported hosted model provider: ${model.provider}`);
  return provider.stream(model, context, options);
}

export async function completeSimple(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) {
  return streamSimple(model, context, options).result();
}

export function resetApiProviders(): void {}

export function getApiProvider(api: string) {
  const provider = [...providers.values()].find((candidate) =>
    candidate.getModels().some((model) => model.api === api),
  );
  return provider
    ? { api, stream: provider.stream.bind(provider), streamSimple: provider.streamSimple.bind(provider) }
    : undefined;
}
