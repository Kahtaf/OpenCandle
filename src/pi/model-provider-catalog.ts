import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import {
  browserSafeModelProviderIds,
  type FirstClassModelProviderId,
  isFirstClassModelProvider,
  type ModelCatalogEntry,
  type ModelSetupProvider,
} from "./model-provider-metadata.js";

export {
  browserSafeModelProviderIds,
  type FirstClassModelProviderId,
  isFirstClassModelProvider,
  type ModelCatalogEntry,
  type ModelSetupProvider,
  modelSetupProviders,
} from "./model-provider-metadata.js";

const providerFactories: Record<FirstClassModelProviderId, () => Provider<Api>> = {
  google: googleProvider,
  openai: openaiProvider,
  anthropic: anthropicProvider,
};

export function createFirstClassModelProviders(): Provider<Api>[] {
  return browserSafeModelProviderIds.map((providerId) => providerFactories[providerId]());
}

export function listFirstClassModelCatalog(): ModelCatalogEntry[] {
  return createFirstClassModelProviders().flatMap((provider) =>
    provider.getModels().map((model) => ({
      provider: model.provider as FirstClassModelProviderId,
      id: model.id,
      label: `${model.provider}/${model.id}`,
    })),
  );
}

export function resolveFirstClassModel(
  providerId: unknown,
  modelId: unknown,
): Model<Api> | undefined {
  if (!isFirstClassModelProvider(providerId) || typeof modelId !== "string") return undefined;
  return providerFactories[providerId]()
    .getModels()
    .find((model) => model.id === modelId);
}

export function sortModels(models: Model<Api>[], preferredProvider?: string): Model<Api>[] {
  return [...models].sort((a, b) => {
    const aPreferred = preferredProvider && a.provider === preferredProvider ? -1 : 0;
    const bPreferred = preferredProvider && b.provider === preferredProvider ? -1 : 0;
    if (aPreferred !== bPreferred) return aPreferred - bPreferred;
    const byProvider = a.provider.localeCompare(b.provider);
    return byProvider !== 0 ? byProvider : a.id.localeCompare(b.id);
  });
}

export function findPreferredModel(
  availableModels: readonly Model<Api>[],
  provider: ModelSetupProvider,
): Model<Api> | undefined {
  const available = sortModels([...availableModels], provider.defaultProvider);
  return (
    available.find(
      (model) => model.provider === provider.defaultProvider && model.id === provider.defaultModel,
    ) ?? available.find((model) => model.provider === provider.defaultProvider)
  );
}
