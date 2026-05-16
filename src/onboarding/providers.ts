// Provider registry — single source of truth for OpenCandle's credentialed
// third-party data providers. Every setup pathway iterates this registry:
// first-run startup, the `/connect` command, the `tool_result` credential
// interception handler, and the gap-note generator all read from here.
//
// Adding a new credentialed provider is a two-step change: add its `ProviderId`
// to the literal union below, and add its descriptor to the `PROVIDERS` array.
// The `satisfies` check ensures TypeScript fails the build if the union and
// the array ever disagree.

import { getConfig, loadFileConfig } from "../config.js";

export type ProviderId =
  | "alpha_vantage"
  | "fred"
  | "finnhub"
  | "brave"
  | "exa";

export type ProviderCategory =
  | "fundamentals"
  | "macro"
  | "news"
  | "web_search";

export type ProviderTier = "hard" | "soft";

export interface ProviderDescriptor {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly category: ProviderCategory;
  /**
   * `hard` providers pause the workflow with a just-in-time prompt when their
   * credential is missing; they have no meaningful fallback.
   *
   * `soft` providers silently use a fallback path and surface a post-answer
   * gap note in the final output.
   */
  readonly tier: ProviderTier;
  /** Lowercase friendly aliases accepted by `/connect` in addition to the id. */
  readonly aliases: readonly string[];
  readonly signupUrl: string;
  readonly freeTier: boolean;
  readonly envVar: string;
  /** Nested key path into `OpenCandleFileConfig` where the key is persisted. */
  readonly configPath: readonly string[];
  readonly unlocks: readonly string[];
  /**
   * Human copy describing the degraded experience when missing, or `null`
   * when there is no fallback (hard tier).
   */
  readonly fallbackDescription: string | null;
  readonly snoozeDurationDays: number;
  readonly instructionsHint: string;
}

// Declaration order matters: picker display order, per-workflow prompt priority,
// getProvidersByCategory/getProvidersByTier iteration order.
export const PROVIDERS = [
  {
    id: "alpha_vantage",
    displayName: "Alpha Vantage",
    category: "fundamentals",
    tier: "hard",
    aliases: ["financials", "fundamentals", "company-financials", "alphavantage"],
    signupUrl: "https://www.alphavantage.co/support/#api-key",
    freeTier: true,
    envVar: "ALPHA_VANTAGE_API_KEY",
    configPath: ["providers", "alphaVantage", "apiKey"],
    unlocks: [
      "company fundamentals",
      "income/balance/cashflow statements",
      "DCF valuation",
      "earnings history",
    ],
    fallbackDescription: null,
    snoozeDurationDays: 7,
    instructionsHint: "Free, about 30 seconds, signup opens in your browser",
  },
  {
    id: "fred",
    displayName: "FRED",
    category: "macro",
    tier: "hard",
    aliases: ["economy", "macro", "economic-data", "st-louis-fed"],
    signupUrl: "https://fredaccount.stlouisfed.org/apikeys",
    freeTier: true,
    envVar: "FRED_API_KEY",
    configPath: ["providers", "fred", "apiKey"],
    unlocks: [
      "interest rates",
      "inflation data",
      "yield curve",
      "economic indicators",
    ],
    fallbackDescription: null,
    snoozeDurationDays: 7,
    instructionsHint: "Free, about 30 seconds, requires a St. Louis Fed account",
  },
  {
    id: "finnhub",
    displayName: "Finnhub",
    category: "news",
    tier: "soft",
    aliases: ["news", "company-news", "finnhub-news"],
    signupUrl: "https://finnhub.io/register",
    freeTier: true,
    envVar: "FINNHUB_API_KEY",
    configPath: ["providers", "finnhub", "apiKey"],
    unlocks: [
      "ticker-tagged company news",
      "sentiment enrichment with a dedicated news source",
    ],
    // Finnhub is a soft enrichment source — sentiment-summary continues to work
    // with Twitter/Reddit/web search when Finnhub is missing. The fallback is
    // "the other sentiment sources still run".
    fallbackDescription:
      "Other sentiment sources (Reddit, Twitter, web search) continue to work without Finnhub",
    snoozeDurationDays: 7,
    instructionsHint: "Free, about 30 seconds, signup opens in your browser",
  },
  {
    id: "brave",
    displayName: "Brave Search",
    category: "web_search",
    tier: "soft",
    aliases: ["brave", "brave-search"],
    signupUrl: "https://brave.com/search/api/",
    freeTier: true,
    envVar: "BRAVE_API_KEY",
    configPath: ["providers", "brave", "apiKey"],
    unlocks: [
      "tier-2 web search with freshness control",
      "independent search index outside of DuckDuckGo",
    ],
    fallbackDescription:
      "Web search continues to work via DuckDuckGo (free, no key needed, lower-quality freshness)",
    snoozeDurationDays: 7,
    instructionsHint: "Free tier available, signup opens in your browser",
  },
  {
    id: "exa",
    displayName: "Exa",
    category: "web_search",
    tier: "soft",
    // Note: "search" is a multi-provider alias shared with Brave. The registry
    // exposes it via resolveProviderFromArgument as a sub-picker case, not as a
    // single-provider alias — so it intentionally does NOT appear in either
    // provider's `aliases` array here. Keeping aliases unique-per-provider lets
    // resolveProviderFromArgument cleanly distinguish the alias case from the
    // sub-picker case.
    aliases: ["exa", "exa-search"],
    signupUrl: "https://dashboard.exa.ai/",
    freeTier: false,
    envVar: "EXA_API_KEY",
    configPath: ["providers", "exa", "apiKey"],
    unlocks: [
      "tier-1 semantic web search",
      "full article text and highlights",
      "higher freshness accuracy than DuckDuckGo",
    ],
    fallbackDescription:
      "Exa search continues to work via the keyless Exa MCP endpoint, which has lower rate limits but similar quality",
    snoozeDurationDays: 7,
    instructionsHint: "Paid with free tier, signup opens in your browser",
  },
] as const satisfies readonly ProviderDescriptor[];

// -----------------------------------------------------------------------------
// Lookup helpers
// -----------------------------------------------------------------------------

// Lazy-built index — populated on first helper call so module import has no
// side effects. The test `importing the registry does not read the filesystem`
// relies on this.
let providersById: Map<ProviderId, ProviderDescriptor> | undefined;

function byId(): Map<ProviderId, ProviderDescriptor> {
  if (!providersById) {
    providersById = new Map(PROVIDERS.map((p) => [p.id, p]));
  }
  return providersById;
}

export function listAllProviders(): readonly ProviderDescriptor[] {
  return PROVIDERS;
}

export function getProvider(id: ProviderId): ProviderDescriptor {
  const found = byId().get(id);
  if (!found) {
    throw new Error(`Unknown provider id: "${id}"`);
  }
  return found;
}

export function getProvidersByCategory(
  category: ProviderCategory,
): readonly ProviderDescriptor[] {
  return PROVIDERS.filter((p) => p.category === category);
}

export function getProvidersByTier(
  tier: ProviderTier,
): readonly ProviderDescriptor[] {
  return PROVIDERS.filter((p) => p.tier === tier);
}

// -----------------------------------------------------------------------------
// Credential source helpers
// -----------------------------------------------------------------------------

function readConfigValueByPath(
  obj: Record<string, unknown>,
  path: readonly string[],
): string | undefined {
  let cursor: unknown = obj;
  for (const segment of path) {
    if (cursor && typeof cursor === "object" && segment in (cursor as object)) {
      cursor = (cursor as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return typeof cursor === "string" && cursor.length > 0 ? cursor : undefined;
}

// Provider-id → `Config` field mapping. `Config` (in src/config.ts) is the
// canonical env-or-file resolved shape that tool implementations already use.
// `hasCredential` reads from `getConfig()` so that tests mocking `getConfig`
// see a consistent view; `getCredentialSource` reads `process.env` +
// `loadFileConfig` directly because it needs to distinguish env from file.
const CONFIG_FIELD_BY_ID: Record<ProviderId, keyof ReturnType<typeof getConfig>> = {
  alpha_vantage: "alphaVantageApiKey",
  fred: "fredApiKey",
  finnhub: "finnhubApiKey",
  brave: "braveApiKey",
  exa: "exaApiKey",
};

export function hasCredential(id: ProviderId): boolean {
  const field = CONFIG_FIELD_BY_ID[id];
  const value = getConfig()[field];
  return typeof value === "string" && value.length > 0;
}

export function getCredentialSource(
  id: ProviderId,
): "env" | "file" | "absent" {
  return getCredential(id).source;
}

export function getCredential(
  id: ProviderId,
): { source: "env" | "file"; value: string } | { source: "absent"; value?: undefined } {
  const descriptor = getProvider(id);
  const envValue = process.env[descriptor.envVar];
  if (envValue && envValue.length > 0) return { source: "env", value: envValue };

  // Lazy file-config read — only invoked when env is absent.
  const fileConfig = loadFileConfig() as unknown as Record<string, unknown>;
  const fileValue = readConfigValueByPath(fileConfig, descriptor.configPath);
  if (fileValue) return { source: "file", value: fileValue };

  return { source: "absent" };
}

// -----------------------------------------------------------------------------
// /connect argument resolution
// -----------------------------------------------------------------------------

export function resolveProviderFromArgument(
  arg: string,
):
  | ProviderDescriptor
  | readonly ProviderDescriptor[]
  | undefined {
  const needle = arg.trim().toLowerCase();
  if (!needle) return undefined;

  // 1. Exact provider id match (case-insensitive).
  for (const p of PROVIDERS) {
    if (p.id === needle) return p;
  }

  // 2. Exact alias match.
  for (const p of PROVIDERS) {
    if ((p.aliases as readonly string[]).includes(needle)) return p;
  }

  // 3. Category match: if the needle matches a category name, return the
  //    providers in that category. One match → single descriptor. Multiple
  //    matches → array (triggers the sub-picker in the /connect handler).
  const categories: readonly ProviderCategory[] = [
    "fundamentals",
    "macro",
    "news",
    "web_search",
  ];
  const normalizedCategory = needle.replace("-", "_");
  if ((categories as readonly string[]).includes(normalizedCategory)) {
    const group = getProvidersByCategory(normalizedCategory as ProviderCategory);
    if (group.length === 1) return group[0];
    if (group.length > 1) return group;
  }

  // 4. Special shared alias: "search" → both web_search providers.
  if (needle === "search" || needle === "web" || needle === "web-search") {
    const searchProviders = getProvidersByCategory("web_search");
    if (searchProviders.length === 1) return searchProviders[0];
    if (searchProviders.length > 1) return searchProviders;
  }

  return undefined;
}
