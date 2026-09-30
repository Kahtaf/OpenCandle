import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { type Api, clampThinkingLevel, type Model } from "@earendil-works/pi-ai";
import {
  ModelRegistry,
  type ModelRuntime,
  type SessionManager,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
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
import { resolveSessionModelSelection } from "../../src/pi/default-model.js";
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
  getSessionId?(): string;
  appendCustomMessageEntry(
    customType: string,
    content: string,
    isActive: boolean,
    data: Record<string, unknown>,
  ): void;
}

/**
 * The per-session part of the model setup state: the model and thinking level
 * one session runs on. Snapshots carry it so the picker shows the visible
 * session's model, not the server's current session's (issue #217).
 */
export interface SessionModelState {
  currentModel?: string;
  currentThinkingLevel?: ThinkingLevel;
  availableThinkingLevels?: ThinkingLevel[];
}

/** Which session a model or thinking change landed on. */
export interface ModelSetupTarget {
  current: boolean;
  sessionManager?: SessionManager;
}

export interface ModelSetupController {
  buildCurrentModelSetupState(): ModelSetupState;
  buildModelSetupStateForSession?(sessionManager: SessionManager): ModelSetupState;
  buildSessionModelState?(sessionManager: SessionManager): SessionModelState;
  /** Saves a key (global) and selects its preferred model in the addressed session. */
  handleSaveModelApiKey(
    providerId: string,
    apiKey: string,
    sessionId?: string,
  ): Promise<ModelSetupTarget | undefined | void>;
  handleSaveProviderApiKey(providerId: string, apiKey: string): Promise<void>;
  /**
   * Picks the model for one session. A pick is session-scoped: it never
   * changes the saved default, which new sessions start on.
   */
  handleSelectModel(
    provider: string,
    modelId: string,
    sessionId?: string,
  ): Promise<ModelSetupTarget | undefined | void>;
  handleSetThinkingLevel?(
    level: string,
    sessionId?: string,
  ): Promise<ModelSetupTarget | undefined | void>;
}

type SessionModelSettings = Pick<
  SettingsManager,
  "getDefaultProvider" | "getDefaultModel" | "getDefaultThinkingLevel" | "getModelThinkingLevel"
>;

export interface ModelSetupControllerOptions {
  role: string;
  getSession: () => ModelSetupSession;
  getSessionManager: () => ModelSetupSessionManager;
  broadcastState: () => void;
  /** Settings used to resolve a stored session's model; required for session-addressed changes. */
  settingsManager?: SessionModelSettings;
  /** Opens a stored session by id; required for session-addressed changes. */
  resolveSessionManager?: (sessionId: string) => Promise<SessionManager | null>;
  /**
   * True while a chat run owns the session. `sessionManager` is given for a
   * stored session, whose run may belong to another process.
   */
  isSessionBusy?: (sessionId: string, sessionManager?: SessionManager) => boolean;
}

export function buildModelSetupState(
  registry: ModelSetupRegistry,
  currentModel: Model<Api> | undefined,
  thinking?: { current: ThinkingLevel; available: ThinkingLevel[] },
): ModelSetupState {
  registry.refresh();
  const availableModels = sortModels(
    registry.getAvailable().filter((model) => registry.hasConfiguredAuth(model)),
  ).map((model) => ({
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

class SessionBusyForModelChange extends Error {
  constructor() {
    super("Wait for this chat's reply to finish before changing its model.");
  }
}

export function createModelSetupController({
  role,
  getSession,
  getSessionManager,
  broadcastState,
  settingsManager,
  resolveSessionManager,
  isSessionBusy,
}: ModelSetupControllerOptions): ModelSetupController {
  function ensureWriter(): void {
    if (role !== "writer") throw new Error("Read-only follower mode");
  }

  function isCurrentSessionId(sessionId: string | undefined): boolean {
    if (!sessionId) return true;
    return getSessionManager().getSessionId?.() === sessionId;
  }

  function storedSessionSelection(sessionManager: SessionManager) {
    if (!settingsManager) throw new Error("Session-addressed model changes are unavailable.");
    return resolveSessionModelSelection({
      modelRuntime: getSession().modelRuntime,
      settingsManager,
      sessionManager,
    });
  }

  function buildSessionModelState(sessionManager: SessionManager): SessionModelState {
    if (isCurrentSessionId(sessionManager.getSessionId())) {
      const session = getSession();
      const model = session.model;
      return {
        currentModel:
          model && session.modelRuntime.hasConfiguredAuth(model.provider)
            ? `${model.provider}/${model.id}`
            : undefined,
        currentThinkingLevel: session.thinkingLevel,
        availableThinkingLevels: session.getAvailableThinkingLevels?.(),
      };
    }
    // Without settings a stored session's model cannot be resolved; report
    // nothing rather than another session's model.
    if (!settingsManager) return {};
    const selection = storedSessionSelection(sessionManager);
    return {
      currentModel: selection.model
        ? `${selection.model.provider}/${selection.model.id}`
        : undefined,
      currentThinkingLevel: selection.thinkingLevel,
      availableThinkingLevels: selection.availableThinkingLevels,
    };
  }

  function buildModelSetupStateForSession(sessionManager: SessionManager): ModelSetupState {
    if (!settingsManager || isCurrentSessionId(sessionManager.getSessionId())) {
      return buildCurrentModelSetupState();
    }
    const selection = storedSessionSelection(sessionManager);
    return buildModelSetupState(
      new ModelRegistry(getSession().modelRuntime),
      selection.model,
      selection.model
        ? { current: selection.thinkingLevel, available: selection.availableThinkingLevels }
        : undefined,
    );
  }

  /** Opens a stored, non-current session for a model or thinking change. */
  async function resolveStoredTarget(sessionId: string): Promise<SessionManager> {
    if (!resolveSessionManager || !settingsManager) {
      throw new Error("Session-addressed model changes are unavailable.");
    }
    const target = await resolveSessionManager(sessionId);
    if (!target) throw new Error("Unknown saved session");
    return target;
  }

  /**
   * Refuses while a chat run owns the session. Callers run this with no await
   * between it and the transcript write, so a run admitted in this process
   * cannot slip in between the check and the write.
   */
  function assertStoredTargetIdle(sessionId: string, target: SessionManager): void {
    if (isSessionBusy?.(sessionId, target)) throw new SessionBusyForModelChange();
  }

  /** A model switch mid-reply would split one answer across two models. */
  function assertCurrentSessionIdle(): void {
    const currentId = getSessionManager().getSessionId?.();
    if (currentId && isSessionBusy?.(currentId)) throw new SessionBusyForModelChange();
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

  async function handleSaveModelApiKey(
    providerId: string,
    apiKey: string,
    sessionId?: string,
  ): Promise<ModelSetupTarget> {
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

    // The key is global; the model it selects belongs to the session on
    // screen. A session busy with a reply keeps its model; the key is saved.
    let target: ModelSetupTarget;
    try {
      target = await applyModelToSession(model, sessionId);
    } catch (error) {
      if (error instanceof SessionBusyForModelChange) {
        broadcastState();
        return { current: isCurrentSessionId(sessionId) };
      }
      throw error;
    }
    await session.settingsManager.flush();
    (target.sessionManager ?? getSessionManager()).appendCustomMessageEntry(
      "opencandle-model-setup",
      `Connected ${provider.label} and selected ${model.provider}/${model.id}.`,
      true,
      { source: "gui", provider: provider.id, model: `${model.provider}/${model.id}` },
    );
    broadcastState();
    return target;
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

  async function handleSelectModel(
    provider: string,
    modelId: string,
    sessionId?: string,
  ): Promise<ModelSetupTarget> {
    ensureWriter();
    const session = getSession();
    await session.modelRuntime.refresh();
    const model = session.modelRuntime.getModel(provider, modelId);
    if (!model) throw new Error(`Unknown model: ${provider}/${modelId}`);
    const target = await applyModelToSession(model, sessionId);
    if (target.current) await session.settingsManager.flush();
    return target;
  }

  /** Puts one session on `model`; never changes the saved default. */
  async function applyModelToSession(
    model: Model<Api>,
    sessionId: string | undefined,
  ): Promise<ModelSetupTarget> {
    const session = getSession();
    if (isCurrentSessionId(sessionId)) {
      assertCurrentSessionIdle();
      // No `persist`: the pick belongs to this session, not the saved default.
      await session.setModel(model);
      return { current: true };
    }

    if (!session.modelRuntime.hasConfiguredAuth(model.provider)) {
      throw new Error(`No API key for ${model.provider}/${model.id}`);
    }
    const storedSessionId = String(sessionId);
    const target = await resolveStoredTarget(storedSessionId);
    // No await from here to the write (see assertStoredTargetIdle).
    assertStoredTargetIdle(storedSessionId, target);
    const before = storedSessionSelection(target);
    target.appendModelChange(model.provider, model.id);
    // Mirror Pi's setModel: the new model's per-model level, then the saved
    // default, then the session's level, clamped to what the model supports.
    const nextLevel = clampThinkingLevel(
      model,
      settingsManager?.getModelThinkingLevel(model.provider, model.id) ??
        settingsManager?.getDefaultThinkingLevel() ??
        before.thinkingLevel,
    );
    if (nextLevel !== before.thinkingLevel) target.appendThinkingLevelChange(nextLevel);
    return { current: false, sessionManager: target };
  }

  async function handleSetThinkingLevel(
    level: string,
    sessionId?: string,
  ): Promise<ModelSetupTarget> {
    ensureWriter();
    if (isCurrentSessionId(sessionId)) {
      assertCurrentSessionIdle();
      const session = getSession();
      const available = session.getAvailableThinkingLevels?.() ?? [];
      if (!available.includes(level as ThinkingLevel) || !session.setThinkingLevel) {
        throw new Error(`Unsupported thinking level: ${level}`);
      }
      session.setThinkingLevel(level as ThinkingLevel);
      await session.settingsManager.flush();
      broadcastState();
      return { current: true };
    }

    const storedSessionId = String(sessionId);
    const target = await resolveStoredTarget(storedSessionId);
    // No await from here to the write (see assertStoredTargetIdle).
    assertStoredTargetIdle(storedSessionId, target);
    const selection = storedSessionSelection(target);
    if (!selection.model || !selection.availableThinkingLevels.includes(level as ThinkingLevel)) {
      throw new Error(`Unsupported thinking level: ${level}`);
    }
    if (level !== selection.thinkingLevel) {
      target.appendThinkingLevelChange(level as ThinkingLevel);
    }
    return { current: false, sessionManager: target };
  }

  return {
    buildCurrentModelSetupState,
    buildModelSetupStateForSession,
    buildSessionModelState,
    handleSaveModelApiKey,
    handleSaveProviderApiKey,
    handleSelectModel,
    handleSetThinkingLevel,
  };
}
