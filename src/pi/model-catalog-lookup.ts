import { firstClassModelCatalog } from "./model-catalog.generated.js";
import { isFirstClassModelProvider, type ModelCatalogEntry } from "./model-provider-metadata.js";

export function resolveFirstClassModelEntry(
  provider: unknown,
  modelId: unknown,
): ModelCatalogEntry | undefined {
  if (!isFirstClassModelProvider(provider) || typeof modelId !== "string") return undefined;
  return firstClassModelCatalog.find(
    (model) => model.provider === provider && model.id === modelId,
  );
}
