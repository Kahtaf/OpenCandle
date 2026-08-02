import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { type ModelKeyProviderId, validateModelKey } from "../onboarding/validate-model-key.js";
import { modelSetupProviders } from "./model-provider-catalog.js";

const guardedRuntimes = new WeakSet<ModelRuntime>();
const previouslyValidated = Symbol("opencandle-model-key-validated");
const firstClassProviders = new Set<ModelKeyProviderId>(
  modelSetupProviders.map((provider) => provider.id as ModelKeyProviderId),
);

/**
 * Makes Pi's built-in `/login` honor OpenCandle's model-key probes before the
 * credential store is modified. OpenCandle's own `/setup` already validates
 * its pasted key before calling ModelRuntime.login.
 */
export function guardModelRuntimeApiKeyLogins(modelRuntime: ModelRuntime): void {
  if (guardedRuntimes.has(modelRuntime)) return;
  guardedRuntimes.add(modelRuntime);

  const login = modelRuntime.login.bind(modelRuntime);
  modelRuntime.login = async (providerId, type, interaction) => {
    if (
      type !== "api_key" ||
      !isFirstClassProvider(providerId) ||
      isPreviouslyValidated(interaction)
    ) {
      return login(providerId, type, interaction);
    }
    return login(providerId, type, withModelKeyProbe(providerId, interaction));
  };
}

export function previouslyValidatedModelKeyInteraction(
  interaction: AuthInteraction,
): AuthInteraction {
  return Object.assign({}, interaction, { [previouslyValidated]: true });
}

function withModelKeyProbe(
  providerId: ModelKeyProviderId,
  interaction: AuthInteraction,
): AuthInteraction {
  return {
    ...interaction,
    prompt: async (prompt) => {
      interaction.signal?.throwIfAborted();
      const key = await interaction.prompt(prompt);
      interaction.signal?.throwIfAborted();
      const normalizedKey = key.trim();
      const validation = await validateModelKey(providerId, normalizedKey);
      interaction.signal?.throwIfAborted();
      if (validation.status === "invalid") {
        throw new Error(`Key was rejected by ${validation.providerLabel}. Paste a different key.`);
      }
      if (validation.status !== "valid") {
        throw new Error(
          `Couldn't verify the ${validation.providerLabel} key (${validation.reason}). The key was not saved.`,
        );
      }
      return normalizedKey;
    },
  };
}

function isFirstClassProvider(providerId: string): providerId is ModelKeyProviderId {
  return firstClassProviders.has(providerId as ModelKeyProviderId);
}

function isPreviouslyValidated(interaction: AuthInteraction): boolean {
  return (
    (interaction as AuthInteraction & { [previouslyValidated]?: boolean })[previouslyValidated] ===
    true
  );
}
