import type { Api, Model } from "@earendil-works/pi-ai";
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

/**
 * Chooses OpenCandle's provider default only where Pi would otherwise fall
 * back to its own provider defaults. Precedence, highest first:
 * 1. a model passed by the caller (handled by the caller, not here)
 * 2. the saved settings default, when it resolves with auth
 * 3. the model recorded in a resumed session, when it resolves with auth
 * 4. OpenCandle's provider default (see findOpenCandleDefaultModel)
 * 5. Pi's own fallback (returned as undefined here)
 */
export function chooseOpenCandleInitialModel(options: {
  modelRuntime: Pick<ModelRuntime, "getModel" | "hasConfiguredAuth">;
  settingsManager: Pick<SettingsManager, "getDefaultProvider" | "getDefaultModel">;
  sessionManager?: Pick<SessionManager, "buildSessionContext">;
}): InitialModelChoice | undefined {
  const lookup = authenticatedRuntimeLookup(options.modelRuntime);

  const savedProvider = options.settingsManager.getDefaultProvider();
  const savedModelId = options.settingsManager.getDefaultModel();
  if (savedProvider && savedModelId && lookup(savedProvider, savedModelId)) return undefined;

  let fallbackMessage: string | undefined;
  const existing = options.sessionManager?.buildSessionContext();
  if (existing && existing.messages.length > 0 && existing.model) {
    const { provider, modelId } = existing.model;
    if (lookup(provider, modelId)) return undefined;
    fallbackMessage = `Could not restore model ${provider}/${modelId}`;
  }

  const model = findOpenCandleDefaultModel(lookup);
  if (!model) return undefined;
  return {
    model,
    fallbackMessage: fallbackMessage
      ? `${fallbackMessage}. Using ${model.provider}/${model.id}`
      : undefined,
  };
}
