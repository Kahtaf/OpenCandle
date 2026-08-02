import type { Api, AuthEvent, AuthPrompt, Model } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  type ExtensionContext,
  LoginDialogComponent,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { validateModelKey } from "../onboarding/validate-model-key.js";
import { previouslyValidatedModelKeyInteraction } from "./model-key-login-guard.js";
import {
  type FirstClassModelProviderId,
  modelSetupProviders,
  sortModels,
} from "./model-provider-catalog.js";

type SetupMode = "startup" | "manual";
type SetupRequirement = "ready" | "select_model" | "connect_auth";
type ApiKeyProviderId = FirstClassModelProviderId;
type OAuthProviderChoice = "google-gemini-cli" | "openai-codex" | "anthropic" | "advanced";
type SetupResult = "ready" | "shutdown" | "cancelled";

/**
 * Registry of "fast default" models for each LLM auth provider. After a fresh
 * sign-in we try to activate the default without opening a picker, falling back
 * to the picker if the registry doesn't have a match available. Keys are auth
 * provider ids (as passed to `authStorage.set`); values are `{ provider, id }`
 * tuples matching `Model.provider` / `Model.id` fields in the Pi model registry.
 *
 * Models here are intentionally mid-tier (flash/haiku/mini) — the goal is a
 * quick-to-respond first chat, not the flagship. Users can swap models later
 * via Pi's built-in model picker.
 */
const DEFAULT_LLM_MODELS: Record<string, { provider: string; id: string }> = {
  // API-key providers
  ...Object.fromEntries(
    modelSetupProviders.map((provider) => [
      provider.id,
      { provider: provider.defaultProvider, id: provider.defaultModel },
    ]),
  ),
  // OAuth providers
  "google-gemini-cli": { provider: "google-gemini-cli", id: "gemini-2.5-flash" },
  "openai-codex": { provider: "openai-codex", id: "gpt-5.1-codex-mini" },
};

/** Human-readable labels for the three API-key providers, used in preamble copy. */
const API_KEY_PROVIDER_LABELS: Record<ApiKeyProviderId, string> = {
  ...Object.fromEntries(modelSetupProviders.map((provider) => [provider.id, provider.label])),
} as Record<ApiKeyProviderId, string>;

function getAvailableModels(ctx: ExtensionContext, preferredProvider?: string): Model<Api>[] {
  ctx.modelRegistry.refresh();
  return sortModels(ctx.modelRegistry.getAvailable(), preferredProvider);
}

export function getLlmSetupRequirement(
  ctx: Pick<ExtensionContext, "model" | "modelRegistry">,
): SetupRequirement {
  if (ctx.model && ctx.modelRegistry.hasConfiguredAuth(ctx.model)) {
    return "ready";
  }
  return ctx.modelRegistry.getAvailable().length > 0 ? "select_model" : "connect_auth";
}

async function selectProviderForApiKey(
  ctx: ExtensionContext,
): Promise<ApiKeyProviderId | undefined> {
  const choice = await ctx.ui.select("Connect an AI model", [
    "Google Gemini API",
    "OpenAI API",
    "Anthropic API",
  ]);
  switch (choice) {
    case "Google Gemini API":
      return "google";
    case "OpenAI API":
      return "openai";
    case "Anthropic API":
      return "anthropic";
    default:
      return undefined;
  }
}

async function selectProviderForLogin(
  ctx: ExtensionContext,
): Promise<OAuthProviderChoice | undefined> {
  const choice = await ctx.ui.select("Connect an AI model", [
    "Google",
    "OpenAI",
    "Anthropic",
    "Advanced setup",
  ]);
  switch (choice) {
    case "Google":
      return "google-gemini-cli";
    case "OpenAI":
      return "openai-codex";
    case "Anthropic":
      return "anthropic";
    case "Advanced setup":
      return "advanced";
    default:
      return undefined;
  }
}

async function selectAdvancedOAuthProvider(
  ctx: ExtensionContext,
  modelRuntime: ModelRuntime,
): Promise<string | undefined> {
  const providers = modelRuntime.getProviders().filter((provider) => provider.auth.oauth?.login);
  if (providers.length === 0) {
    ctx.ui.notify("No sign-in providers are available.", "warning");
    return undefined;
  }
  const labels = providers.map((provider) => provider.name);
  const choice = await ctx.ui.select("Choose a provider", labels);
  return providers.find((provider) => provider.name === choice)?.id;
}

async function runLoginDialog(
  ctx: ExtensionContext,
  providerId: string,
  modelRuntime: ModelRuntime,
): Promise<boolean> {
  const provider = modelRuntime.getProvider(providerId);
  const providerName = provider?.name ?? providerId;

  const success = await ctx.ui.custom<boolean>((tui, _theme, _keybindings, done) => {
    let finished = false;
    const finish = (value: boolean) => {
      if (finished) return;
      finished = true;
      done(value);
    };

    const dialog = new LoginDialogComponent(tui, providerId, (completed) => {
      finish(completed);
    });

    const prompt = async (request: AuthPrompt): Promise<string> => {
      if (request.type === "select") {
        const options = request.options
          .map((option, index) => `${index + 1}. ${option.label}`)
          .join("\n");
        const answer = await dialog.showPrompt(
          `${request.message}\n\n${options}`,
          "Enter a number",
        );
        const selectedIndex = Number.parseInt(answer.trim(), 10) - 1;
        return request.options[selectedIndex]?.id ?? "";
      }
      return dialog.showPrompt(request.message, request.placeholder);
    };
    const notify = (event: AuthEvent): void => {
      if (event.type === "auth_url") dialog.showAuth(event.url, event.instructions);
      else if (event.type === "device_code") {
        dialog.showDeviceCode({
          userCode: event.userCode,
          verificationUri: event.verificationUri,
        });
        dialog.showWaiting("Waiting for authentication...");
      } else if (event.type === "progress" || event.type === "info")
        dialog.showProgress(event.message);
    };

    void modelRuntime
      .login(providerId, "oauth", {
        prompt,
        notify,
        signal: dialog.signal,
      })
      .then(() => finish(true))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== "Login cancelled") {
          ctx.ui.notify(`Failed to connect ${providerName}: ${message}`, "error");
        }
        finish(false);
      });

    return dialog;
  });

  if (success) {
    ctx.modelRegistry.refresh();
    ctx.ui.notify(`Connected ${providerName}.`, "info");
    return true;
  }

  return false;
}

export async function runApiKeySetup(
  ctx: ExtensionContext,
  provider: ApiKeyProviderId,
  modelRuntime: ModelRuntime,
): Promise<boolean> {
  const label = API_KEY_PROVIDER_LABELS[provider];
  ctx.ui.notify(
    `OpenCandle stores your ${label} API key locally. After saving it, OpenCandle will select a fast default model when one is available.`,
    "info",
  );
  const key = await ctx.ui.input(`Paste your ${label} API key`, "API key");
  const trimmed = key?.trim();
  if (!trimmed) {
    ctx.ui.notify("No API key entered.", "warning");
    return false;
  }
  const validation = await validateModelKey(provider, trimmed);
  if (validation.status === "invalid") {
    ctx.ui.notify(
      `Key was rejected by ${validation.providerLabel}. Paste a different key.`,
      "error",
    );
    return false;
  }
  if (validation.status !== "valid") {
    ctx.ui.notify(
      `Couldn't verify the ${validation.providerLabel} key (${validation.reason}). The key was not saved. Try again when the provider is reachable.`,
      "error",
    );
    return false;
  }
  await modelRuntime.login(
    provider,
    "api_key",
    previouslyValidatedModelKeyInteraction({
      prompt: async () => trimmed,
      notify: () => {},
    }),
  );
  await ctx.modelRegistry.refresh();
  ctx.ui.notify(`${label} API key saved to OpenCandle.`, "info");
  return true;
}

/**
 * Attempt to activate the registered default model for `authProviderId`.
 * Returns `true` on success, `false` if no default is registered, the default
 * isn't currently available in `getAvailable()`, or `api.setModel` fails (in
 * which case the caller should fall through to the model picker).
 */
async function activateDefaultModel(
  api: ExtensionAPI,
  ctx: ExtensionContext,
  authProviderId: string,
): Promise<boolean> {
  const defaultModel = DEFAULT_LLM_MODELS[authProviderId];
  if (!defaultModel) {
    return false;
  }

  ctx.modelRegistry.refresh();
  const match = ctx.modelRegistry
    .getAvailable()
    .find(
      (candidate) =>
        candidate.provider === defaultModel.provider && candidate.id === defaultModel.id,
    );
  if (!match) {
    return false;
  }

  const ok = await api.setModel(match);
  if (!ok) {
    return false;
  }

  ctx.ui.notify(`Model selected: ${match.provider}/${match.id}`, "info");
  return true;
}

async function selectModel(
  api: ExtensionAPI,
  ctx: ExtensionContext,
  preferredProvider?: string,
): Promise<boolean> {
  const models = getAvailableModels(ctx, preferredProvider);
  if (models.length === 0) {
    ctx.ui.notify("No available models found yet. Connect a provider first.", "warning");
    return false;
  }

  const labels = models.map((model) => `${model.provider}/${model.id}`);
  const choice = await ctx.ui.select("Choose a model", labels);
  if (!choice) {
    return false;
  }

  const model = models.find((candidate) => `${candidate.provider}/${candidate.id}` === choice);
  if (!model) {
    return false;
  }

  const ok = await api.setModel(model);
  if (!ok) {
    ctx.ui.notify("Unable to activate the selected model.", "error");
    return false;
  }

  ctx.ui.notify(`Model selected: ${model.provider}/${model.id}`, "info");
  return true;
}

async function runLlmSetup(
  api: ExtensionAPI,
  ctx: ExtensionContext,
  mode: SetupMode,
  modelRuntime?: ModelRuntime,
): Promise<SetupResult> {
  while (true) {
    const requirement = getLlmSetupRequirement(ctx);
    if (requirement === "ready") {
      return "ready";
    }

    if (requirement === "select_model") {
      const selected = await selectModel(api, ctx);
      if (selected) {
        return "ready";
      }
      const retry = await ctx.ui.select("Model setup", ["Try again", "Exit setup"]);
      if (retry !== "Try again") {
        if (mode === "startup") {
          ctx.ui.notify("OpenCandle needs an AI model before chat can start.", "warning");
          ctx.shutdown();
          return "shutdown";
        }
        return "cancelled";
      }
      continue;
    }

    const choice = await ctx.ui.select(
      "Welcome to OpenCandle — connect one AI model to start chatting",
      ["Sign in with browser", "Paste API key", "Exit setup"],
    );

    if (choice !== "Sign in with browser" && choice !== "Paste API key") {
      if (mode === "startup") {
        ctx.ui.notify("OpenCandle needs an AI model before chat can start.", "warning");
        ctx.shutdown();
        return "shutdown";
      }
      return "cancelled";
    }

    if (choice === "Sign in with browser") {
      if (!modelRuntime) {
        ctx.ui.notify("Model authentication is unavailable in this session.", "error");
        return "cancelled";
      }
      const providerChoice = await selectProviderForLogin(ctx);
      if (!providerChoice) {
        continue;
      }

      const providerId =
        providerChoice === "advanced"
          ? await selectAdvancedOAuthProvider(ctx, modelRuntime)
          : providerChoice;
      if (!providerId) {
        continue;
      }

      const loggedIn = await runLoginDialog(ctx, providerId, modelRuntime);
      if (!loggedIn) {
        continue;
      }

      // Try the registered default for the provider we just signed into —
      // this is the fast path that avoids the model picker entirely.
      if (await activateDefaultModel(api, ctx, providerId)) {
        return "ready";
      }
      const selected = await selectModel(api, ctx, providerId);
      if (selected) {
        return "ready";
      }
      continue;
    }

    const provider = await selectProviderForApiKey(ctx);
    if (!provider) {
      continue;
    }

    if (!modelRuntime) {
      ctx.ui.notify("Model authentication is unavailable in this session.", "error");
      return "cancelled";
    }
    const saved = await runApiKeySetup(ctx, provider, modelRuntime);
    if (!saved) {
      continue;
    }

    // Try the registered default for the provider we just pasted a key for.
    if (await activateDefaultModel(api, ctx, provider)) {
      return "ready";
    }
    const selected = await selectModel(api, ctx, provider);
    if (selected) {
      return "ready";
    }
  }
}

export async function runOpenCandleSetup(
  api: ExtensionAPI,
  ctx: ExtensionContext,
  options: { mode: SetupMode } = { mode: "startup" },
  modelRuntime?: ModelRuntime,
): Promise<SetupResult> {
  const initialRequirement = getLlmSetupRequirement(ctx);
  if (initialRequirement !== "ready" || options.mode === "manual") {
    return runLlmSetup(api, ctx, options.mode, modelRuntime);
  }
  return "ready";
}
