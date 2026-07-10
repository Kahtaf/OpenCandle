import type { Api, Model } from "@earendil-works/pi-ai";
import { persistProviderCredential } from "../../src/onboarding/connect.js";
import {
  getCredentialSource,
  isApiKeyProvider,
  PROVIDERS,
} from "../../src/onboarding/providers.js";
import {
  type ModelKeyProviderId,
  validateModelKey,
} from "../../src/onboarding/validate-model-key.js";
import { validateCredential } from "../../src/onboarding/validation.js";

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

interface ModelSetupAuthStorage {
  set(provider: string, credential: { type: "api_key"; key: string }): void;
}

interface MutableModelSetupRegistry extends ModelSetupRegistry {
  authStorage: ModelSetupAuthStorage;
  find(provider: string, modelId: string): Model<Api> | undefined;
}

interface ModelSetupSession {
  modelRegistry: MutableModelSetupRegistry;
  model?: Model<Api>;
  setModel(model: Model<Api>): Promise<void>;
  settingsManager: {
    flush(): Promise<void>;
  };
}

interface ModelSetupSessionManager {
  appendCustomMessageEntry(
    customType: string,
    content: string,
    isActive: boolean,
    data: Record<string, unknown>,
  ): void;
}

export interface ModelSetupController {
  buildCurrentModelSetupState(): ModelSetupState;
  handleSaveModelApiKey(providerId: string, apiKey: string): Promise<void>;
  handleSaveProviderApiKey(providerId: string, apiKey: string): Promise<void>;
  handleSelectModel(provider: string, modelId: string): Promise<void>;
}

export interface ModelSetupControllerOptions {
  role: string;
  getSession: () => ModelSetupSession;
  getSessionManager: () => ModelSetupSessionManager;
  broadcastState: () => void;
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
    // A fresh session still carries a placeholder model with no usable
    // credentials; reporting it would render its raw id as the composer label.
    currentModel:
      currentModel && registry.hasConfiguredAuth(currentModel)
        ? `${currentModel.provider}/${currentModel.id}`
        : undefined,
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

export function createModelSetupController({
  role,
  getSession,
  getSessionManager,
  broadcastState,
}: ModelSetupControllerOptions): ModelSetupController {
  function ensureWriter(): void {
    if (role !== "writer") throw new Error("Read-only follower mode");
  }

  function buildCurrentModelSetupState(): ModelSetupState {
    const session = getSession();
    return buildModelSetupState(session.modelRegistry, session.model);
  }

  async function handleSaveModelApiKey(providerId: string, apiKey: string): Promise<void> {
    ensureWriter();

    const provider = modelSetupProviders.find((candidate) => candidate.id === providerId);
    if (!provider) throw new Error(`Unknown model provider: ${providerId}`);

    const trimmed = apiKey.trim();
    if (!trimmed) throw new Error(`Paste a ${provider.label} API key first.`);

    const validation = await validateModelKey(provider.id as ModelKeyProviderId, trimmed);
    if (validation.status === "invalid") {
      throw new Error(
        `Key was rejected by ${validation.providerLabel}. The existing configuration was not changed.`,
      );
    }

    const session = getSession();
    session.modelRegistry.authStorage.set(provider.id, { type: "api_key", key: trimmed });
    session.modelRegistry.refresh();

    const model = findPreferredModel(session.modelRegistry, provider);
    if (!model) {
      throw new Error(
        `Saved the ${provider.label} key, but no ${provider.label} models are available yet.`,
      );
    }

    await session.setModel(model);
    await session.settingsManager.flush();
    getSessionManager().appendCustomMessageEntry(
      "opencandle-model-setup",
      validation.status === "transient"
        ? `Saved — couldn't verify (network issue). Connected ${provider.label} and selected ${model.provider}/${model.id}.`
        : `Connected ${provider.label} and selected ${model.provider}/${model.id}.`,
      true,
      { source: "gui", provider: provider.id, model: `${model.provider}/${model.id}` },
    );
    broadcastState();
  }

  async function handleSaveProviderApiKey(providerId: string, apiKey: string): Promise<void> {
    ensureWriter();

    const descriptor = PROVIDERS.find((candidate) => candidate.id === providerId);
    if (!descriptor) throw new Error(`Unknown provider: ${providerId}`);
    if (!isApiKeyProvider(descriptor)) {
      throw new Error(`${descriptor.displayName} is not configured with an API key.`);
    }

    if (getCredentialSource(descriptor.id) === "env") {
      throw new Error(
        `${descriptor.displayName} is set via the ${descriptor.envVar} environment variable. Unset it to override here.`,
      );
    }

    const trimmed = apiKey.trim();
    if (!trimmed) throw new Error(`Paste a ${descriptor.displayName} API key first.`);

    const validation = await validateCredential(descriptor.id, trimmed);
    if (validation.status === "invalid") {
      const statusHint =
        validation.httpStatus !== undefined ? ` (HTTP ${validation.httpStatus})` : "";
      const messageHint = validation.message ? ` — ${validation.message}` : "";
      throw new Error(
        `${descriptor.displayName} rejected the key${statusHint}${messageHint}. The existing configuration was not changed.`,
      );
    }

    persistProviderCredential(descriptor.id, trimmed);

    const verifiedNote =
      validation.status === "transient"
        ? `Saved ${descriptor.displayName} key but couldn't verify it (${validation.reason}). The next request will surface any issue.`
        : `Connected ${descriptor.displayName}. Key saved to ~/.opencandle/config.json.`;

    getSessionManager().appendCustomMessageEntry("opencandle-provider-setup", verifiedNote, true, {
      source: "gui",
      provider: descriptor.id,
      status: validation.status,
    });
    broadcastState();
  }

  async function handleSelectModel(provider: string, modelId: string): Promise<void> {
    ensureWriter();
    const session = getSession();
    session.modelRegistry.refresh();
    const model = session.modelRegistry.find(provider, modelId);
    if (!model) throw new Error(`Unknown model: ${provider}/${modelId}`);
    await session.setModel(model);
    await session.settingsManager.flush();
  }

  return {
    buildCurrentModelSetupState,
    handleSaveModelApiKey,
    handleSaveProviderApiKey,
    handleSelectModel,
  };
}
