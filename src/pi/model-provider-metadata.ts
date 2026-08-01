export const browserSafeModelProviderIds = ["google", "openai", "anthropic"] as const;
export type FirstClassModelProviderId = (typeof browserSafeModelProviderIds)[number];

export interface ModelSetupProvider {
  id: FirstClassModelProviderId;
  label: string;
  envVar: string;
  defaultProvider: FirstClassModelProviderId;
  defaultModel: string;
  signupUrl: string;
}

export interface ModelCatalogEntry {
  provider: FirstClassModelProviderId;
  id: string;
  label: string;
}

export const modelSetupProviders: readonly ModelSetupProvider[] = [
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
] as const;

export function isFirstClassModelProvider(value: unknown): value is FirstClassModelProviderId {
  return (
    typeof value === "string" &&
    browserSafeModelProviderIds.includes(value as FirstClassModelProviderId)
  );
}
