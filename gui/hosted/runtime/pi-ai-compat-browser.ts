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
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";

const provider = openaiProvider();

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
  return provider.streamSimple(model, context, options);
}

export function stream(model: Model<Api>, context: Context, options?: StreamOptions) {
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
  return api === "openai-responses"
    ? {
        api,
        stream: provider.stream.bind(provider),
        streamSimple: provider.streamSimple.bind(provider),
      }
    : undefined;
}
