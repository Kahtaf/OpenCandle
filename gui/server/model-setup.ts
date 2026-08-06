import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { ModelRegistry, type ModelRuntime } from "@earendil-works/pi-coding-agent";
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
import { previouslyValidatedModelKeyInteraction } from "../../src/pi/model-key-login-guard.js";
import {
  findPreferredModel as findPreferredModelFromCatalog,
  type ModelSetupProvider,
  modelSetupProviders,
  sortModels,
} from "../../src/pi/model-provider-catalog.js";

export type ModelSetupRequirement = "ready" | "select_model" | "connect_auth";

export type { ModelSetupProvider } from "../../src/pi/model-provider-catalog.js";
export { modelSetupProviders, sortModels } from "../../src/pi/model-provider-catalog.js";

export interface ModelSetupState {
  requirement: ModelSetupRequirement;
  currentModel?: string;
  providers: ModelSetupProvider[];
  availableModels: Array<{ provider: string; id: string; label: string }>;
  currentThinkingLevel?: ThinkingLevel;
  availableThinkingLevels?: ThinkingLevel[];
}

export interface ModelSetupRegistry {
  refresh(): void;
  getAvailable(): Model<Api>[];
  hasConfiguredAuth(model: Model<Api>): boolean;
}

interface ModelSetupSession {
  modelRuntime: ModelRuntime;
  model?: Model<Api>;
  setModel(model: Model<Api>): Promise<void>;
  thinkingLevel?: ThinkingLevel;
  getAvailableThinkingLevels?(): ThinkingLevel[];
  setThinkingLevel?(level: ThinkingLevel): void;
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
  handleSetThinkingLevel?(level: string): Promise<void>;
}

export interface ModelSetupControllerOptions {
  role: string;
  getSession: () => ModelSetupSession;
  getSessionManager: () => ModelSetupSessionManager;
  broadcastState: () => void;
}

export function buildModelSetupState(
  registry: ModelSetupRegistry,
  currentModel: Model<Api> | undefined,
  thinking?: { current: ThinkingLevel; available: ThinkingLevel[] },
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
    ...(thinking
      ? {
          currentThinkingLevel: thinking.current,
          availableThinkingLevels: thinking.available,
        }
      : {}),
  };
}

export function findPreferredModel(
  registry: Pick<ModelSetupRegistry, "getAvailable">,
  provider: ModelSetupProvider,
): Model<Api> | undefined {
  return findPreferredModelFromCatalog(registry.getAvailable(), provider);
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
    return buildModelSetupState(
      new ModelRegistry(session.modelRuntime),
      session.model,
      session.thinkingLevel && session.getAvailableThinkingLevels
        ? {
            current: session.thinkingLevel,
            available: session.getAvailableThinkingLevels(),
          }
        : undefined,
    );
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
    if (validation.status !== "valid") {
      throw new Error(
        `Couldn't verify the ${validation.providerLabel} key (${validation.reason}). The existing configuration was not changed.`,
      );
    }

    const session = getSession();
    await session.modelRuntime.login(
      provider.id,
      "api_key",
      previouslyValidatedModelKeyInteraction({
        prompt: async () => trimmed,
        notify: () => {},
      }),
    );
    const modelRegistry = new ModelRegistry(session.modelRuntime);

    const model = findPreferredModel(modelRegistry, provider);
    if (!model) {
      throw new Error(
        `Saved the ${provider.label} key, but no ${provider.label} models are available yet.`,
      );
    }

    await session.setModel(model);
    await session.settingsManager.flush();
    getSessionManager().appendCustomMessageEntry(
      "opencandle-model-setup",
      `Connected ${provider.label} and selected ${model.provider}/${model.id}.`,
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
    if (validation.status !== "valid") {
      throw new Error(
        `Couldn't verify the ${descriptor.displayName} key (${validation.reason}). The existing configuration was not changed.`,
      );
    }

    persistProviderCredential(descriptor.id, trimmed);

    const verifiedNote = `Connected ${descriptor.displayName}. Key saved to ~/.opencandle/config.json.`;

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
    await session.modelRuntime.refresh();
    const model = session.modelRuntime.getModel(provider, modelId);
    if (!model) throw new Error(`Unknown model: ${provider}/${modelId}`);
    await session.setModel(model);
    await session.settingsManager.flush();
  }

  async function handleSetThinkingLevel(level: string): Promise<void> {
    ensureWriter();
    const session = getSession();
    const available = session.getAvailableThinkingLevels?.() ?? [];
    if (!available.includes(level as ThinkingLevel) || !session.setThinkingLevel) {
      throw new Error(`Unsupported thinking level: ${level}`);
    }
    session.setThinkingLevel(level as ThinkingLevel);
    await session.settingsManager.flush();
    broadcastState();
  }

  return {
    buildCurrentModelSetupState,
    handleSaveModelApiKey,
    handleSaveProviderApiKey,
    handleSelectModel,
    handleSetThinkingLevel,
  };
}
