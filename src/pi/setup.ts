import type { Model } from "@earendil-works/pi-ai";
import {
  LoginDialogComponent,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type SetupMode = "startup" | "manual";
type SetupRequirement = "ready" | "select_model" | "connect_auth";
type ApiKeyProviderId = "google" | "openai" | "anthropic";
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
  google: { provider: "google", id: "gemini-2.5-flash" },
  openai: { provider: "openai", id: "gpt-5-mini" },
  anthropic: { provider: "anthropic", id: "claude-haiku-4-5" },
  // OAuth providers
  "google-gemini-cli": { provider: "google-gemini-cli", id: "gemini-2.5-flash" },
  "openai-codex": { provider: "openai-codex", id: "gpt-5.1-codex-mini" },
};

/** Human-readable labels for the three API-key providers, used in preamble copy. */
const API_KEY_PROVIDER_LABELS: Record<ApiKeyProviderId, string> = {
  google: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

function sortModels(models: Model<any>[], preferredProvider?: string): Model<any>[] {
  return [...models].sort((a, b) => {
    const aPreferred = preferredProvider && a.provider === preferredProvider ? -1 : 0;
    const bPreferred = preferredProvider && b.provider === preferredProvider ? -1 : 0;
    if (aPreferred !== bPreferred) return aPreferred - bPreferred;
    const byProvider = a.provider.localeCompare(b.provider);
    return byProvider !== 0 ? byProvider : a.id.localeCompare(b.id);
  });
}

function getAvailableModels(ctx: ExtensionContext, preferredProvider?: string): Model<any>[] {
  ctx.modelRegistry.refresh();
  return sortModels(ctx.modelRegistry.getAvailable(), preferredProvider);
}

export function getLlmSetupRequirement(ctx: Pick<ExtensionContext, "model" | "modelRegistry">): SetupRequirement {
  if (ctx.model && ctx.modelRegistry.hasConfiguredAuth(ctx.model)) {
    return "ready";
  }
  return ctx.modelRegistry.getAvailable().length > 0 ? "select_model" : "connect_auth";
}

async function selectProviderForApiKey(ctx: ExtensionContext): Promise<ApiKeyProviderId | undefined> {
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

async function selectProviderForLogin(ctx: ExtensionContext): Promise<OAuthProviderChoice | undefined> {
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

async function selectAdvancedOAuthProvider(ctx: ExtensionContext): Promise<string | undefined> {
  const providers = ctx.modelRegistry.authStorage.getOAuthProviders();
  if (providers.length === 0) {
    ctx.ui.notify("No sign-in providers are available.", "warning");
    return undefined;
  }
  const labels = providers.map((provider) => provider.name);
  const choice = await ctx.ui.select("Choose a provider", labels);
  return providers.find((provider) => provider.name === choice)?.id;
}

async function runLoginDialog(ctx: ExtensionContext, providerId: string): Promise<boolean> {
  const provider = ctx.modelRegistry.authStorage.getOAuthProviders().find((item) => item.id === providerId);
  const providerName = provider?.name ?? providerId;
  const usesCallbackServer = provider?.usesCallbackServer ?? false;

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

    let manualCodeResolve: ((value: string) => void) | undefined;
    let manualCodeReject: ((error: Error) => void) | undefined;
    const manualCodePromise = new Promise<string>((resolve, reject) => {
      manualCodeResolve = resolve;
      manualCodeReject = reject;
    });

    // Cast required: advanced providers return dynamic IDs outside the SDK's static union type
    void ctx.modelRegistry.authStorage.login(providerId as any, {
      onAuth: (info) => {
        dialog.showAuth(info.url, info.instructions);
        if (usesCallbackServer) {
          void dialog
            .showManualInput("Paste redirect URL below, or complete login in your browser:")
            .then((value) => {
              if (value && manualCodeResolve) {
                manualCodeResolve(value);
                manualCodeResolve = undefined;
              }
            })
            .catch(() => {
              if (manualCodeReject) {
                manualCodeReject(new Error("Login cancelled"));
                manualCodeReject = undefined;
              }
            });
        } else if (providerId === "github-copilot") {
          dialog.showWaiting("Waiting for browser authentication...");
        }
      },
      onPrompt: async (prompt) => dialog.showPrompt(prompt.message, prompt.placeholder),
      onProgress: (message) => dialog.showProgress(message),
      onManualCodeInput: () => manualCodePromise,
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

async function runApiKeySetup(ctx: ExtensionContext, provider: ApiKeyProviderId): Promise<boolean> {
  const label = API_KEY_PROVIDER_LABELS[provider];
  ctx.ui.notify(
    `OpenCandle stores your ${label} API key locally and only sends it to ${label}.`,
    "info",
  );
  const key = await ctx.ui.input(`Paste your ${label} API key for OpenCandle`, "sk-...");
  const trimmed = key?.trim();
  if (!trimmed) {
    ctx.ui.notify("No API key entered.", "warning");
    return false;
  }
  ctx.modelRegistry.authStorage.set(provider, { type: "api_key", key: trimmed });
  ctx.modelRegistry.refresh();
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

async function selectModel(api: ExtensionAPI, ctx: ExtensionContext, preferredProvider?: string): Promise<boolean> {
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
      "Welcome to OpenCandle — sign in or paste an API key to start chatting",
      ["Sign in", "Paste API key", "Exit setup"],
    );

    if (choice !== "Sign in" && choice !== "Paste API key") {
      if (mode === "startup") {
        ctx.ui.notify("OpenCandle needs an AI model before chat can start.", "warning");
        ctx.shutdown();
        return "shutdown";
      }
      return "cancelled";
    }

    if (choice === "Sign in") {
      const providerChoice = await selectProviderForLogin(ctx);
      if (!providerChoice) {
        continue;
      }

      const providerId =
        providerChoice === "advanced" ? await selectAdvancedOAuthProvider(ctx) : providerChoice;
      if (!providerId) {
        continue;
      }

      const loggedIn = await runLoginDialog(ctx, providerId);
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

    const saved = await runApiKeySetup(ctx, provider);
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
): Promise<SetupResult> {
  const initialRequirement = getLlmSetupRequirement(ctx);
  if (initialRequirement !== "ready" || options.mode === "manual") {
    return runLlmSetup(api, ctx, options.mode);
  }
  return "ready";
}
