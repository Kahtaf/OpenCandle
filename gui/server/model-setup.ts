import type { Api, Model } from "@earendil-works/pi-ai";

export type ModelSetupRequirement = "ready" | "select_model" | "connect_auth";

export interface ModelSetupProvider {
  id: string;
  label: string;
  envVar: string;
  defaultProvider: string;
  defaultModel: string;
  signupUrl: string;
}

export interface ModelSetupState {
  requirement: ModelSetupRequirement;
  currentModel?: string;
  providers: ModelSetupProvider[];
  availableModels: Array<{ provider: string; id: string; label: string }>;
}

export interface ModelSetupRegistry {
  refresh(): void;
  getAvailable(): Model<Api>[];
  hasConfiguredAuth(model: Model<Api>): boolean;
}

export const modelSetupProviders: ModelSetupProvider[] = [
  {
    id: "google",
    label: "Google Gemini",
    envVar: "GEMINI_API_KEY",
    defaultProvider: "google",
    defaultModel: "gemini-2.5-flash",
    signupUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "openai",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    defaultProvider: "openai",
    defaultModel: "gpt-5-mini",
    signupUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    defaultProvider: "anthropic",
    defaultModel: "claude-haiku-4-5",
    signupUrl: "https://console.anthropic.com/settings/keys",
  },
];

export function buildModelSetupState(
  registry: ModelSetupRegistry,
  currentModel: Model<Api> | undefined,
): ModelSetupState {
  registry.refresh();
  const availableModels = sortModels(registry.getAvailable()).map((model) => ({
    provider: model.provider,
    id: model.id,
    label: `${model.provider}/${model.id}`,
  }));
  const requirement =
    currentModel && registry.hasConfiguredAuth(currentModel)
      ? "ready"
      : availableModels.length > 0
        ? "select_model"
        : "connect_auth";

  return {
    requirement,
    currentModel: currentModel ? `${currentModel.provider}/${currentModel.id}` : undefined,
    providers: modelSetupProviders,
    availableModels,
  };
}

export function findPreferredModel(
  registry: Pick<ModelSetupRegistry, "getAvailable">,
  provider: ModelSetupProvider,
): Model<Api> | undefined {
  const available = sortModels(registry.getAvailable(), provider.defaultProvider);
  return (
    available.find(
      (model) => model.provider === provider.defaultProvider && model.id === provider.defaultModel,
    ) ?? available.find((model) => model.provider === provider.defaultProvider)
  );
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
