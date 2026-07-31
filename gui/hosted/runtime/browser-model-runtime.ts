import {
  createModels,
  InMemoryCredentialStore,
  type Model,
  type Provider,
} from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/**
 * Build the smallest Pi ModelRuntime-compatible surface for hosted OpenCandle.
 *
 * Pi's public session constructor currently accepts its concrete ModelRuntime
 * class, while the agent loop itself consumes the public Models methods plus a
 * few runtime metadata helpers. This adapter composes those methods from
 * pi-ai's public createModels() API and registers only the OpenAI provider.
 */
export async function createBrowserOpenAiModelRuntime(
  apiKey: string,
  modelId: string,
): Promise<ModelRuntime> {
  const key = apiKey.trim();
  if (!key) throw new Error("OpenAI API key must not be blank");

  const credentials = new InMemoryCredentialStore();
  await credentials.modify("openai", async () => ({ type: "api_key", key }));

  const models = createModels({ credentials });
  const provider = openaiProvider();
  const model = provider.getModels().find((candidate) => candidate.id === modelId);
  if (!model) throw new Error(`Unsupported OpenAI model: ${modelId}`);
  models.setProvider(provider);

  const configuredProviders = new Set(["openai"]);
  let availableSnapshot = [...(await models.getAvailable())];
  const nativeProviders = new Map<string, Provider>();

  const additions: Record<PropertyKey, unknown> = {
    getAvailableSnapshot: () => availableSnapshot,
    getError: () => undefined,
    hasConfiguredAuth: (providerId: string) => configuredProviders.has(providerId),
    isUsingOAuth: () => false,
    getProviderAuthStatus: (providerId: string) =>
      configuredProviders.has(providerId)
        ? { configured: true, source: "runtime" }
        : { configured: false },
    setRuntimeApiKey: async (providerId: string, nextKey: string) => {
      if (providerId !== "openai") throw new Error(`Unsupported provider: ${providerId}`);
      await credentials.modify(providerId, async () => ({
        type: "api_key",
        key: nextKey,
      }));
      configuredProviders.add(providerId);
      availableSnapshot = [...(await models.getAvailable())];
    },
    removeRuntimeApiKey: async (providerId: string) => {
      await credentials.delete(providerId);
      configuredProviders.delete(providerId);
      availableSnapshot = [...(await models.getAvailable())];
    },
    listCredentials: () => credentials.list(),
    getRegisteredProviderConfig: () => undefined,
    getRegisteredProviderIds: () => [...nativeProviders.keys()],
    getRegisteredNativeProvider: (providerId: string) => nativeProviders.get(providerId),
    getCompatibilityRequestConfig: (_model: Model<string>) => ({}),
    registerNativeProvider: (nextProvider: Provider) => {
      nativeProviders.set(nextProvider.id, nextProvider);
      models.setProvider(nextProvider);
    },
    registerProvider: () => {
      throw new Error("Hosted runtime does not support dynamic provider registration");
    },
    unregisterProvider: (providerId: string) => {
      nativeProviders.delete(providerId);
      models.deleteProvider(providerId);
    },
  };

  return new Proxy(models, {
    get(target, property, receiver) {
      const value =
        property in additions ? additions[property] : Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(property in additions ? additions : target) : value;
    },
  }) as unknown as ModelRuntime;
}
