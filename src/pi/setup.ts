import type { Model } from "@mariozechner/pi-ai";
import {
  LoginDialogComponent,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { loadFileConfig, saveFileConfig, type VantageFileConfig } from "../config.js";
import { ONBOARDING_VERSION, loadOnboardingState, saveOnboardingState } from "../onboarding/state.js";

const SETUP_STATUS_KEY = "vantage-setup";

type SetupMode = "startup" | "manual";
type SetupRequirement = "ready" | "select_model" | "connect_auth";
type ApiKeyProviderId = "google" | "openai" | "anthropic";
type OAuthProviderChoice = "google-gemini-cli" | "openai-codex" | "anthropic" | "advanced";
type SetupResult = "ready" | "shutdown" | "cancelled";

function renderSetupHeader(title: string, body: string[]) {
  return (_tui: unknown, theme: { bold(text: string): string; fg(name: string, text: string): string }) => ({
    render(): string[] {
      return [
        "",
        theme.bold(theme.fg("accent", "Vantage Setup")),
        theme.fg("muted", title),
        "",
        ...body.map((line) => theme.fg("dim", line)),
        "",
      ];
    },
    invalidate() {},
  });
}

function setSetupChrome(ctx: ExtensionContext, title: string, body: string[]): void {
  ctx.ui.setHeader(renderSetupHeader(title, body));
  ctx.ui.setStatus(SETUP_STATUS_KEY, title);
}

function clearSetupChrome(ctx: ExtensionContext): void {
  ctx.ui.setHeader(undefined);
  ctx.ui.setStatus(SETUP_STATUS_KEY, undefined);
}

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
  const key = await ctx.ui.input("Paste your API key", "sk-...");
  const trimmed = key?.trim();
  if (!trimmed) {
    ctx.ui.notify("No API key entered.", "warning");
    return false;
  }
  ctx.modelRegistry.authStorage.set(provider, { type: "api_key", key: trimmed });
  ctx.modelRegistry.refresh();
  ctx.ui.notify("API key saved.", "info");
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
      setSetupChrome(ctx, "Choose an AI model", [
        "You already have at least one Pi-connected provider.",
        "Pick the model Vantage should use for chat and analysis.",
      ]);
      const selected = await selectModel(api, ctx);
      if (selected) {
        return "ready";
      }
      const retry = await ctx.ui.select("Model setup", ["Try again", "Exit setup"]);
      if (retry !== "Try again") {
        if (mode === "startup") {
          ctx.ui.notify("Vantage needs an AI model before chat can start.", "warning");
          ctx.shutdown();
          return "shutdown";
        }
        return "cancelled";
      }
      continue;
    }

    setSetupChrome(ctx, "Connect an AI model", [
      "Welcome to Vantage.",
      "Choose sign-in or paste an API key to enable chat and analysis.",
    ]);

    const choice = await ctx.ui.select("Welcome to Vantage", [
      "Sign in",
      "Paste API key",
      "Exit setup",
    ]);

    if (choice !== "Sign in" && choice !== "Paste API key") {
      if (mode === "startup") {
        ctx.ui.notify("Vantage needs an AI model before chat can start.", "warning");
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

    const selected = await selectModel(api, ctx, provider);
    if (selected) {
      return "ready";
    }
  }
}

function hasFinanceKeys(fileConfig: VantageFileConfig): boolean {
  return Boolean(
    fileConfig.providers?.alphaVantage?.apiKey && fileConfig.providers?.fred?.apiKey,
  );
}

function upsertFinanceKey(
  config: VantageFileConfig,
  provider: "alphaVantage" | "fred",
  apiKey: string,
): VantageFileConfig {
  return {
    ...config,
    providers: {
      ...config.providers,
      [provider]: {
        ...(config.providers?.[provider] ?? {}),
        apiKey,
      },
    },
  };
}

async function runFinanceSetup(ctx: ExtensionContext, forcePrompt: boolean): Promise<void> {
  const effectiveConfig = loadFileConfig();
  if (hasFinanceKeys(effectiveConfig)) {
    saveOnboardingState({ version: ONBOARDING_VERSION, financeSetupStatus: "completed" });
    return;
  }

  const onboardingState = loadOnboardingState();
  if (
    !forcePrompt &&
    (onboardingState.financeSetupStatus === "dismissed" ||
      onboardingState.financeSetupStatus === "completed")
  ) {
    return;
  }

  setSetupChrome(ctx, "Connect market data providers", [
    "Alpha Vantage unlocks fundamentals, earnings, and DCF.",
    "FRED unlocks interest rates, inflation, and macro data.",
  ]);

  const choice = await ctx.ui.select("Connect market data providers (optional)", [
    "Yes",
    "Skip for now",
  ]);

  if (choice !== "Yes") {
    saveOnboardingState({ version: ONBOARDING_VERSION, financeSetupStatus: "dismissed" });
    return;
  }

  let nextConfig = effectiveConfig;

  if (!nextConfig.providers?.alphaVantage?.apiKey) {
    const alphaKey = await ctx.ui.input("Alpha Vantage API key (optional)", "Enter key or leave blank");
    const trimmed = alphaKey?.trim();
    if (trimmed) {
      nextConfig = upsertFinanceKey(nextConfig, "alphaVantage", trimmed);
    }
  }

  if (!nextConfig.providers?.fred?.apiKey) {
    const fredKey = await ctx.ui.input("FRED API key (optional)", "Enter key or leave blank");
    const trimmed = fredKey?.trim();
    if (trimmed) {
      nextConfig = upsertFinanceKey(nextConfig, "fred", trimmed);
    }
  }

  if (nextConfig !== effectiveConfig) {
    saveFileConfig(nextConfig);
  }

  const status = hasFinanceKeys(nextConfig) ? "completed" : "dismissed";
  saveOnboardingState({ version: ONBOARDING_VERSION, financeSetupStatus: status });
}

export async function runVantageSetup(
  api: ExtensionAPI,
  ctx: ExtensionContext,
  options: { mode: SetupMode; forceFinancePrompt?: boolean } = { mode: "startup" },
): Promise<SetupResult> {
  const initialRequirement = getLlmSetupRequirement(ctx);
  if (initialRequirement !== "ready" || options.mode === "manual") {
    const result = await runLlmSetup(api, ctx, options.mode);
    if (result === "shutdown" || result === "cancelled") {
      clearSetupChrome(ctx);
      return result;
    }
  }

  await runFinanceSetup(ctx, options.forceFinancePrompt ?? options.mode === "manual");
  clearSetupChrome(ctx);
  return "ready";
}
