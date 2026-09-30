import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  type Api,
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type Model,
} from "@earendil-works/pi-ai";
import type {
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { modelSetupProviders } from "./model-provider-metadata.js";

/** Returns the model only when it exists and its provider has usable auth. */
export type AuthenticatedModelLookup = (
  provider: string,
  modelId: string,
) => Model<Api> | undefined;

/**
 * OpenCandle's per-provider default model for the first first-class provider
 * with configured auth. Providers are tried in `modelSetupProviders` order
 * (Google, OpenAI, Anthropic), so several keys resolve deterministically.
 */
export function findOpenCandleDefaultModel(
  lookup: AuthenticatedModelLookup,
): Model<Api> | undefined {
  for (const provider of modelSetupProviders) {
    const model = lookup(provider.defaultProvider, provider.defaultModel);
    if (model) return model;
  }
  return undefined;
}

export function authenticatedRuntimeLookup(
  modelRuntime: Pick<ModelRuntime, "getModel" | "hasConfiguredAuth">,
): AuthenticatedModelLookup {
  return (provider, modelId) => {
    const model = modelRuntime.getModel(provider, modelId);
    return model && modelRuntime.hasConfiguredAuth(model.provider) ? model : undefined;
  };
}

export interface InitialModelChoice {
  model: Model<Api>;
  /** Pi's restore warning when a resumed session's model could not be used. */
  fallbackMessage?: string;
}

type SessionModelSource = Pick<SessionManager, "buildSessionContext" | "getBranch">;
type DefaultModelSettings = Pick<SettingsManager, "getDefaultProvider" | "getDefaultModel">;

/**
 * Chooses the model a session starts on. Model and thinking level are
 * per-session: a session keeps what it recorded (issue #217). Precedence,
 * highest first:
 * 1. a model passed by the caller (handled by the caller, not here)
 * 2. the model the session itself recorded (its last `model_change` or
 *    assistant turn), when it resolves with auth; this covers a model picked
 *    before the session's first message, which Pi alone would not restore
 * 3. the saved settings default, when it resolves with auth (Pi applies it)
 * 4. OpenCandle's provider default (see findOpenCandleDefaultModel)
 * 5. Pi's own fallback (returned as undefined here)
 *
 * The saved default is written only by an explicit default choice, such as
 * Pi's `/model` in the terminal. A GUI pick changes only its own session.
 */
export function chooseOpenCandleInitialModel(options: {
  modelRuntime: Pick<ModelRuntime, "getModel" | "hasConfiguredAuth">;
  settingsManager: DefaultModelSettings;
  sessionManager?: Pick<SessionManager, "buildSessionContext">;
}): InitialModelChoice | undefined {
  const lookup = authenticatedRuntimeLookup(options.modelRuntime);

  let fallbackMessage: string | undefined;
  const existing = options.sessionManager?.buildSessionContext();
  if (existing?.model) {
    const { provider, modelId } = existing.model;
    const own = lookup(provider, modelId);
    if (own) return { model: own };
    if (existing.messages.length > 0) {
      fallbackMessage = `Could not restore model ${provider}/${modelId}`;
    }
  }

  if (savedDefaultModel(lookup, options.settingsManager)) return undefined;

  const model = findOpenCandleDefaultModel(lookup);
  if (!model) return undefined;
  return {
    model,
    fallbackMessage: fallbackMessage
      ? `${fallbackMessage}. Using ${model.provider}/${model.id}`
      : undefined,
  };
}

function savedDefaultModel(
  lookup: AuthenticatedModelLookup,
  settingsManager: DefaultModelSettings,
): Model<Api> | undefined {
  const provider = settingsManager.getDefaultProvider();
  const modelId = settingsManager.getDefaultModel();
  return provider && modelId ? lookup(provider, modelId) : undefined;
}

/** The thinking level a session recorded itself, if it has one. */
export function recordedSessionThinkingLevel(
  sessionManager: SessionModelSource | undefined,
): ThinkingLevel | undefined {
  if (!sessionManager) return undefined;
  const hasEntry = sessionManager
    .getBranch()
    .some((entry) => entry.type === "thinking_level_change");
  return hasEntry
    ? (sessionManager.buildSessionContext().thinkingLevel as ThinkingLevel)
    : undefined;
}

export interface SessionModelSelection {
  model?: Model<Api>;
  thinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
}

/**
 * The model and thinking level a stored session will run on when it is next
 * opened, without creating an AgentSession. Mirrors the precedence above and
 * Pi's thinking-level restore (recorded level, then per-model setting, then
 * the saved default), clamped to what the model supports.
 */
export function resolveSessionModelSelection(options: {
  modelRuntime: Pick<ModelRuntime, "getModel" | "hasConfiguredAuth">;
  settingsManager: DefaultModelSettings &
    Pick<SettingsManager, "getDefaultThinkingLevel" | "getModelThinkingLevel">;
  sessionManager: SessionModelSource;
}): SessionModelSelection {
  const lookup = authenticatedRuntimeLookup(options.modelRuntime);
  const model =
    chooseOpenCandleInitialModel(options)?.model ??
    savedDefaultModel(lookup, options.settingsManager);
  if (!model) return { thinkingLevel: "off", availableThinkingLevels: [] };
  const requested =
    recordedSessionThinkingLevel(options.sessionManager) ??
    options.settingsManager.getModelThinkingLevel(model.provider, model.id) ??
    options.settingsManager.getDefaultThinkingLevel() ??
    DEFAULT_THINKING_LEVEL;
  return {
    model,
    thinkingLevel: clampThinkingLevel(model, requested),
    availableThinkingLevels: getSupportedThinkingLevels(model),
  };
}

/** Pi's built-in thinking default when neither the session nor settings set one. */
const DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";
