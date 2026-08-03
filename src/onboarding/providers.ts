// Provider registry — single source of truth for OpenCandle's third-party
// data providers. Every setup/status pathway iterates this registry:
// first-run startup, the `/connect` command, the `tool_result` credential
// interception handler, GUI provider rows, doctor checks, and gap-note
// generation all read from here.
//
// Adding a new provider is a two-step change: add its id to the relevant
// literal union below, and add its descriptor to the `PROVIDERS` array. The
// `satisfies` and exhaustiveness checks keep the registry and id unions aligned.

import { getConfig, loadFileConfig } from "../config.js";

export type ApiKeyProviderId = "alpha_vantage" | "fred" | "finnhub" | "brave" | "exa" | "lse";
export type ExternalToolProviderId = "twitter" | "reddit";
export type PublicHttpProviderId =
  | "coingecko"
  | "ddg"
  | "fear_greed"
  | "polymarket"
  | "sec_edgar"
  | "tradingview"
  | "yahoo";
export type ProviderId = ApiKeyProviderId | ExternalToolProviderId | PublicHttpProviderId;

export type ProviderCategory =
  | "fundamentals"
  | "macro"
  | "news"
  | "web_search"
  | "sentiment"
  | "market";

export type ProviderTier = "hard" | "soft";

export type BrowserTransport =
  | {
      readonly mode: "direct";
      readonly reason: string;
      readonly proof: {
        readonly browser: "chromium";
        readonly test: string;
        readonly verifiedAt: string;
      };
    }
  | {
      readonly mode: "proxy" | "blocked";
      readonly reason: string;
    };

interface BaseProviderDescriptor {
  readonly id: ProviderId;
  readonly kind: "api-key" | "external-tool" | "public-http";
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
  readonly unlocks: readonly string[];
  /**
   * Human copy describing the degraded experience when missing, or `null`
   * when there is no fallback (hard tier).
   */
  readonly fallbackDescription: string | null;
  readonly snoozeDurationDays: number;
  readonly instructionsHint: string;
  /** Hosted mode is fail closed: only a descriptor with live `direct` proof is callable. */
  readonly browserTransport: BrowserTransport;
}

export interface ApiKeyProviderDescriptor extends BaseProviderDescriptor {
  readonly id: ApiKeyProviderId;
  readonly kind: "api-key";
  readonly signupUrl: string;
  readonly freeTier: boolean;
  readonly envVar: string;
  /** Nested key path into `OpenCandleFileConfig` where the key is persisted. */
  readonly configPath: readonly string[];
}

export interface ExternalToolProviderDescriptor extends BaseProviderDescriptor {
  readonly id: ExternalToolProviderId;
  readonly kind: "external-tool";
  readonly binary: string;
  readonly installCmd: string;
  readonly sessionSource: "browser-cookies";
  readonly supportedBrowsers?: readonly string[];
  readonly sessionProbeArgs?: readonly string[];
}

export interface PublicHttpProviderDescriptor extends BaseProviderDescriptor {
  readonly id: PublicHttpProviderId;
  readonly kind: "public-http";
  readonly probeUrl: string;
  readonly probeHeaders?: Readonly<Record<string, string>>;
}

export type ProviderDescriptor =
  | ApiKeyProviderDescriptor
  | ExternalToolProviderDescriptor
  | PublicHttpProviderDescriptor;

// Declaration order matters: picker display order, per-workflow prompt priority,
// getProvidersByCategory/getProvidersByTier iteration order.
export const PROVIDERS = [
  {
    id: "alpha_vantage",
    kind: "api-key",
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
    browserTransport: {
      mode: "direct",
      reason: "The production API passes the hosted Chromium CORS and live-key response proof.",
      proof: {
        browser: "chromium",
        test: "gui/hosted/tests/hosted-pwa.e2e.mjs",
        verifiedAt: "2026-07-31",
      },
    },
  },
  {
    id: "fred",
    kind: "api-key",
    displayName: "FRED",
    category: "macro",
    tier: "hard",
    aliases: ["economy", "macro", "economic-data", "st-louis-fed"],
    signupUrl: "https://fredaccount.stlouisfed.org/apikeys",
    freeTier: true,
    envVar: "FRED_API_KEY",
    configPath: ["providers", "fred", "apiKey"],
    unlocks: ["interest rates", "inflation data", "yield curve", "economic indicators"],
    fallbackDescription: null,
    snoozeDurationDays: 7,
    instructionsHint: "Free, about 30 seconds, requires a St. Louis Fed account",
    browserTransport: {
      mode: "proxy",
      reason: "FRED has not passed the hosted Chromium CORS and API-key handling proof.",
    },
  },
  {
    id: "finnhub",
    kind: "api-key",
    displayName: "Finnhub",
    category: "news",
    tier: "soft",
    aliases: ["news", "company-news", "finnhub-news"],
    signupUrl: "https://finnhub.io/register",
    freeTier: true,
    envVar: "FINNHUB_API_KEY",
    configPath: ["providers", "finnhub", "apiKey"],
    unlocks: ["ticker-tagged company news", "sentiment enrichment with a dedicated news source"],
    // Finnhub is a soft enrichment source — sentiment-summary continues to work
    // with Twitter/Reddit/web search when Finnhub is missing. The fallback is
    // "the other sentiment sources still run".
    fallbackDescription:
      "Other sentiment sources (Reddit, Twitter, web search) continue to work without Finnhub",
    snoozeDurationDays: 7,
    instructionsHint: "Free, about 30 seconds, signup opens in your browser",
    browserTransport: {
      mode: "proxy",
      reason: "Finnhub has not passed the hosted Chromium CORS and API-key handling proof.",
    },
  },
  {
    id: "ddg",
    kind: "public-http",
    displayName: "DuckDuckGo",
    category: "web_search",
    tier: "soft",
    aliases: ["ddg", "duckduckgo"],
    probeUrl: "https://duckduckgo.com/",
    unlocks: ["keyless web and news search fallback"],
    fallbackDescription: "Web search remains available through configured Exa or Brave Search",
    snoozeDurationDays: 7,
    instructionsHint:
      "No account needed; OpenCandle uses DuckDuckGo as the keyless search fallback",
    browserTransport: {
      mode: "proxy",
      reason:
        "The shared DDG client uses Node transport, so hosted requests use the audited relay's fixed DuckDuckGo endpoints.",
    },
  },
  {
    id: "brave",
    kind: "api-key",
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
    browserTransport: {
      mode: "proxy",
      reason:
        "Brave Search requires a request path that has not passed the hosted Chromium CORS proof.",
    },
  },
  {
    id: "exa",
    kind: "api-key",
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
    browserTransport: {
      mode: "proxy",
      reason: "Exa has not passed the hosted Chromium CORS and API-key handling proof.",
    },
  },
  {
    id: "lse",
    kind: "api-key",
    displayName: "London Strategic Edge",
    category: "market",
    tier: "soft",
    aliases: ["lse", "london strategic edge", "londonstrategicedge"],
    signupUrl: "https://londonstrategicedge.com/databank",
    freeTier: true,
    envVar: "LSE_API_KEY",
    configPath: ["providers", "lse", "apiKey"],
    unlocks: [
      "financial statements (income, balance sheet, and cash flow)",
      "deep split-adjusted intraday history back to 2003",
    ],
    fallbackDescription:
      "Market data continues through Yahoo Finance and Alpha Vantage when London Strategic Edge is unavailable",
    snoozeDurationDays: 7,
    instructionsHint: "Free, about 30 seconds, signup opens in your browser",
    browserTransport: {
      mode: "proxy",
      reason:
        "London Strategic Edge has not passed the hosted Chromium CORS and API-key handling proof.",
    },
  },
  {
    id: "coingecko",
    kind: "public-http",
    displayName: "CoinGecko",
    category: "market",
    tier: "hard",
    aliases: ["coingecko", "crypto-market-data"],
    probeUrl: "https://api.coingecko.com/api/v3/coins/bitcoin",
    unlocks: ["cryptocurrency prices", "cryptocurrency price history"],
    fallbackDescription: null,
    snoozeDurationDays: 7,
    instructionsHint: "No account needed; OpenCandle checks the public CoinGecko API",
    browserTransport: {
      mode: "direct",
      reason: "The public API passes the hosted Chromium CORS and bounded-response proof.",
      proof: {
        browser: "chromium",
        test: "gui/hosted/tests/hosted-pwa.e2e.mjs",
        verifiedAt: "2026-07-31",
      },
    },
  },
  {
    id: "sec_edgar",
    kind: "public-http",
    displayName: "SEC EDGAR",
    category: "fundamentals",
    tier: "hard",
    aliases: ["sec", "edgar", "sec-filings"],
    probeUrl: "https://www.sec.gov/files/company_tickers.json",
    probeHeaders: { "User-Agent": "OpenCandle/1.0 (financial analysis agent)" },
    unlocks: ["SEC filing search", "company submissions", "filing documents"],
    fallbackDescription: null,
    snoozeDurationDays: 7,
    instructionsHint: "No account needed; OpenCandle checks the public SEC EDGAR endpoints",
    browserTransport: {
      mode: "proxy",
      reason: "SEC EDGAR requires an identified server-side request path.",
    },
  },
  {
    id: "fear_greed",
    kind: "public-http",
    displayName: "Fear & Greed Index",
    category: "sentiment",
    tier: "soft",
    aliases: ["fear-greed", "fear-and-greed"],
    probeUrl: "https://api.alternative.me/fng/?limit=1",
    unlocks: ["crypto market fear and greed index"],
    fallbackDescription: "Other market and sentiment tools continue when the index is unavailable",
    snoozeDurationDays: 7,
    instructionsHint: "No account needed; OpenCandle checks the public Alternative.me API",
    browserTransport: {
      mode: "proxy",
      reason: "The index endpoint has not passed a stable direct-browser CORS proof.",
    },
  },
  {
    id: "yahoo",
    kind: "public-http",
    displayName: "Yahoo Finance",
    category: "market",
    tier: "hard",
    aliases: ["yahoo", "yahoo-finance", "market-data", "options"],
    probeUrl: "https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1d",
    unlocks: ["quotes", "historical prices", "option chains", "market data"],
    fallbackDescription: null,
    snoozeDurationDays: 7,
    instructionsHint: "No account needed; OpenCandle checks public Yahoo Finance reachability",
    browserTransport: {
      mode: "proxy",
      reason:
        "Yahoo Finance does not provide a stable direct-browser CORS contract for OpenCandle.",
    },
  },
  {
    id: "polymarket",
    kind: "public-http",
    displayName: "Polymarket",
    category: "macro",
    tier: "hard",
    aliases: ["polymarket", "prediction-markets", "event-probabilities"],
    probeUrl: "https://gamma-api.polymarket.com/public-search?q=fed%20rate%20cut&limit=1",
    unlocks: ["market-implied event probabilities", "prediction-market resolution criteria"],
    fallbackDescription: null,
    snoozeDurationDays: 7,
    instructionsHint: "No account needed; OpenCandle checks public Polymarket Gamma reachability",
    browserTransport: {
      mode: "direct",
      reason:
        "The public Gamma endpoint passes the hosted Chromium CORS and bounded-response proof.",
      proof: {
        browser: "chromium",
        test: "gui/hosted/tests/hosted-pwa.e2e.mjs",
        verifiedAt: "2026-07-30",
      },
    },
  },
  {
    id: "tradingview",
    kind: "public-http",
    displayName: "TradingView Scanner",
    category: "market",
    tier: "soft",
    aliases: ["tradingview", "tradingview-scanner", "screener"],
    probeUrl: "https://scanner.tradingview.com/america/scan2?label-product=screener-stock",
    unlocks: ["stock screens", "ticker search fallback", "watchlist quote fallback"],
    fallbackDescription:
      "Core market quote/history tools continue through Yahoo and Alpha Vantage when TradingView scanner is unavailable",
    snoozeDurationDays: 7,
    instructionsHint:
      "No account needed; OpenCandle checks the public TradingView scanner endpoint",
    browserTransport: {
      mode: "proxy",
      reason: "The unofficial scanner endpoint has not passed a stable hosted Chromium CORS proof.",
    },
  },
  {
    id: "twitter",
    kind: "external-tool",
    displayName: "X / Twitter",
    category: "sentiment",
    tier: "soft",
    aliases: ["twitter", "x", "x-sentiment", "twitter-sentiment"],
    binary: "twitter",
    installCmd: "uv tool install twitter-cli",
    sessionSource: "browser-cookies",
    sessionProbeArgs: ["feed", "--max", "1", "--json"],
    supportedBrowsers: ["Chrome", "Arc", "Edge", "Firefox", "Brave"],
    unlocks: ["X/Twitter sentiment", "recent ticker mentions", "social engagement context"],
    fallbackDescription:
      "Sentiment summaries continue with Reddit, web search, and news when X is unavailable",
    snoozeDurationDays: 7,
    instructionsHint: "Install twitter-cli and stay logged into x.com in a supported browser",
    browserTransport: {
      mode: "blocked",
      reason: "X requires the native twitter CLI and a desktop browser-cookie session.",
    },
  },
  {
    id: "reddit",
    kind: "external-tool",
    displayName: "Reddit",
    category: "sentiment",
    tier: "soft",
    aliases: ["reddit", "reddit-sentiment", "subreddit"],
    binary: "rdt",
    installCmd: "uv tool install rdt-cli",
    sessionSource: "browser-cookies",
    supportedBrowsers: ["Chrome", "Arc", "Edge", "Firefox", "Brave"],
    sessionProbeArgs: ["status", "--json"],
    unlocks: ["Reddit sentiment", "ticker discussion context", "retail investor discussion"],
    fallbackDescription:
      "Sentiment summaries continue with X/Twitter, web search, and news when Reddit is unavailable",
    snoozeDurationDays: 7,
    instructionsHint: "Install rdt-cli and stay logged into reddit.com in a supported browser",
    browserTransport: {
      mode: "blocked",
      reason: "Reddit requires the native rdt CLI and a desktop browser-cookie session.",
    },
  },
] as const satisfies readonly ProviderDescriptor[];

const _providerIdExhaustivenessCheck: Record<
  | Exclude<ProviderId, (typeof PROVIDERS)[number]["id"]>
  | Exclude<(typeof PROVIDERS)[number]["id"], ProviderId>,
  never
> = {};
void _providerIdExhaustivenessCheck;

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

export function getHostedBrowserCapabilityReport(): {
  direct: readonly ProviderDescriptor[];
  unavailable: readonly ProviderDescriptor[];
} {
  const direct = PROVIDERS.filter((provider) => provider.browserTransport.mode === "direct");
  return {
    direct,
    unavailable: PROVIDERS.filter((provider) => provider.browserTransport.mode !== "direct"),
  };
}

export function resolveHostedBrowserCapabilityReport(relayProviders: readonly string[] = []): {
  direct: readonly ProviderDescriptor[];
  relayed: readonly ProviderDescriptor[];
  available: readonly ProviderDescriptor[];
  unavailable: readonly ProviderDescriptor[];
} {
  const relay = new Set(relayProviders);
  const direct = PROVIDERS.filter((provider) => provider.browserTransport.mode === "direct");
  const relayed = PROVIDERS.filter(
    (provider) => provider.browserTransport.mode === "proxy" && relay.has(provider.id),
  );
  const availableIds = new Set([...direct, ...relayed].map((provider) => provider.id));
  return {
    direct,
    relayed,
    available: PROVIDERS.filter((provider) => availableIds.has(provider.id)),
    unavailable: PROVIDERS.filter((provider) => !availableIds.has(provider.id)),
  };
}

export function isApiKeyProvider(
  provider: ProviderDescriptor,
): provider is ApiKeyProviderDescriptor {
  return provider.kind === "api-key";
}

export function isExternalToolProvider(
  provider: ProviderDescriptor,
): provider is ExternalToolProviderDescriptor {
  return provider.kind === "external-tool";
}

export function isPublicHttpProvider(
  provider: ProviderDescriptor,
): provider is PublicHttpProviderDescriptor {
  return provider.kind === "public-http";
}

export function listApiKeyProviders(): readonly ApiKeyProviderDescriptor[] {
  return (PROVIDERS as readonly ProviderDescriptor[]).filter(isApiKeyProvider);
}

export function getProvider(id: ProviderId): ProviderDescriptor {
  const found = byId().get(id);
  if (!found) {
    throw new Error(`Unknown provider id: "${id}"`);
  }
  return found;
}

export function getProvidersByCategory(category: ProviderCategory): readonly ProviderDescriptor[] {
  return PROVIDERS.filter((p) => p.category === category);
}

export function getProvidersByTier(tier: ProviderTier): readonly ProviderDescriptor[] {
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
const CONFIG_FIELD_BY_ID: Record<ApiKeyProviderId, keyof ReturnType<typeof getConfig>> = {
  alpha_vantage: "alphaVantageApiKey",
  fred: "fredApiKey",
  finnhub: "finnhubApiKey",
  brave: "braveApiKey",
  exa: "exaApiKey",
  lse: "lseApiKey",
};

export function hasCredential(id: ProviderId): boolean {
  const descriptor = getProvider(id);
  if (!isApiKeyProvider(descriptor)) return false;
  const field = CONFIG_FIELD_BY_ID[descriptor.id];
  const value = getConfig()[field];
  return typeof value === "string" && value.length > 0;
}

export function getCredentialSource(id: ProviderId): "env" | "file" | "absent" {
  return getCredential(id).source;
}

export function getCredential(
  id: ProviderId,
): { source: "env" | "file"; value: string } | { source: "absent"; value?: undefined } {
  const descriptor = getProvider(id);
  if (!isApiKeyProvider(descriptor)) return { source: "absent" };

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
): ProviderDescriptor | readonly ProviderDescriptor[] | undefined {
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
    "sentiment",
    "market",
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
