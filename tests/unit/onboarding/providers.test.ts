import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../../src/config.js";
import * as configModule from "../../../src/config.js";
import {
  getCredential,
  getCredentialSource,
  getHostedBrowserCapabilityReport,
  getProvider,
  getProvidersByCategory,
  getProvidersByTier,
  hasCredential,
  isApiKeyProvider,
  isExternalToolProvider,
  isPublicHttpProvider,
  listAllProviders,
  PROVIDERS,
  type ProviderId,
  resolveHostedBrowserCapabilityReport,
  resolveProviderFromArgument,
} from "../../../src/onboarding/providers.js";

const ENV_KEYS = [
  "ALPHA_VANTAGE_API_KEY",
  "FRED_API_KEY",
  "FINNHUB_API_KEY",
  "BRAVE_API_KEY",
  "EXA_API_KEY",
  "LSE_API_KEY",
] as const;

const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
const DEFAULT_EMPTY_CONFIG = {
  alphaVantageApiKey: undefined,
  fredApiKey: undefined,
  braveApiKey: undefined,
  exaApiKey: undefined,
  finnhubApiKey: undefined,
  lseApiKey: undefined,
  routerMode: "llm",
  toolScopeMode: "observe",
  sentiment: undefined,
} satisfies Config;

beforeEach(() => {
  for (const k of ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
  // Default: empty config so hasCredential returns false unless a test overrides.
  vi.spyOn(configModule, "getConfig").mockReturnValue(DEFAULT_EMPTY_CONFIG);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = originalEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

describe("provider registry — shape", () => {
  it("classifies every provider for hosted-browser transport and fails closed", () => {
    const report = getHostedBrowserCapabilityReport();

    expect(report.direct.map((provider) => provider.id)).toEqual([
      "alpha_vantage",
      "coingecko",
      "polymarket",
    ]);
    expect(report.unavailable).toHaveLength(PROVIDERS.length - 3);
    for (const provider of PROVIDERS) {
      expect(["direct", "proxy", "blocked"]).toContain(provider.browserTransport.mode);
      expect(provider.browserTransport.reason.trim()).not.toBe("");
      if (provider.browserTransport.mode === "direct") {
        expect(provider.browserTransport.proof).toMatchObject({
          browser: "chromium",
          test: expect.stringContaining("hosted-pwa.e2e"),
        });
      }
    }
  });

  it("identifies desktop-cookie providers as blocked and CORS-only providers as proxy", () => {
    expect(getProvider("twitter").browserTransport).toMatchObject({
      mode: "blocked",
      reason: expect.stringContaining("CLI"),
    });
    expect(getProvider("reddit").browserTransport).toMatchObject({
      mode: "blocked",
      reason: expect.stringContaining("CLI"),
    });
    expect(getProvider("yahoo").browserTransport.mode).toBe("proxy");
  });

  it("resolves proxy providers through a compatible hosted relay without unblocking CLIs", () => {
    const report = resolveHostedBrowserCapabilityReport(["yahoo", "fred", "twitter"]);

    expect(report.direct.map((provider) => provider.id)).toEqual([
      "alpha_vantage",
      "coingecko",
      "polymarket",
    ]);
    expect(report.relayed.map((provider) => provider.id).sort()).toEqual(["fred", "yahoo"]);
    expect(report.available.map((provider) => provider.id).sort()).toEqual([
      "alpha_vantage",
      "coingecko",
      "fred",
      "polymarket",
      "yahoo",
    ]);
    expect(report.unavailable.map((provider) => provider.id)).toContain("twitter");
  });

  it("contains API-key, external-tool, and public HTTP providers with stable ids", () => {
    const ids = PROVIDERS.map((p) => p.id).sort();
    expect(ids).toEqual(
      [
        "alpha_vantage",
        "brave",
        "coingecko",
        "ddg",
        "exa",
        "fear_greed",
        "finnhub",
        "fred",
        "lse",
        "polymarket",
        "reddit",
        "sec_edgar",
        "tradingview",
        "twitter",
        "yahoo",
      ].sort(),
    );
  });

  it("every descriptor has all required fields", () => {
    for (const p of PROVIDERS) {
      expect(["api-key", "external-tool", "public-http"]).toContain(p.kind);
      expect(p.id).toBeTruthy();
      expect(p.displayName).toBeTruthy();
      expect(["fundamentals", "macro", "news", "web_search", "sentiment", "market"]).toContain(
        p.category,
      );
      expect(["hard", "soft"]).toContain(p.tier);
      expect(Array.isArray(p.aliases)).toBe(true);
      expect(p.aliases.length).toBeGreaterThan(0);
      expect(Array.isArray(p.unlocks)).toBe(true);
      expect(p.unlocks.length).toBeGreaterThan(0);
      expect(p.snoozeDurationDays).toBeGreaterThan(0);
      expect(p.instructionsHint).toBeTruthy();
      // fallbackDescription may be null or string, never undefined
      expect(p.fallbackDescription === null || typeof p.fallbackDescription === "string").toBe(
        true,
      );

      if (isApiKeyProvider(p)) {
        expect(p.signupUrl).toMatch(/^https:\/\//);
        expect(typeof p.freeTier).toBe("boolean");
        expect(p.envVar).toMatch(/^[A-Z][A-Z0-9_]*$/);
        expect(p.configPath.length).toBeGreaterThan(0);
      } else if (isExternalToolProvider(p)) {
        expect(p.binary).toBeTruthy();
        expect(p.installCmd).toContain(p.binary);
        expect(p.sessionSource).toBeTruthy();
        expect("envVar" in p).toBe(false);
        expect("signupUrl" in p).toBe(false);
      } else if (isPublicHttpProvider(p)) {
        expect(p.probeUrl).toMatch(/^https:\/\//);
        expect("envVar" in p).toBe(false);
        expect("signupUrl" in p).toBe(false);
      }
    }
  });

  it("hard-tier providers have null fallback descriptions", () => {
    const hard = PROVIDERS.filter((p) => p.tier === "hard");
    expect(hard.map((p) => p.id).sort()).toEqual([
      "alpha_vantage",
      "coingecko",
      "fred",
      "polymarket",
      "sec_edgar",
      "yahoo",
    ]);
    for (const p of hard) {
      expect(p.fallbackDescription).toBeNull();
    }
  });

  it("soft-tier providers all have non-null fallback descriptions", () => {
    const soft = PROVIDERS.filter((p) => p.tier === "soft");
    expect(soft.map((p) => p.id).sort()).toEqual(
      [
        "brave",
        "ddg",
        "exa",
        "fear_greed",
        "finnhub",
        "lse",
        "reddit",
        "tradingview",
        "twitter",
      ].sort(),
    );
    for (const p of soft) {
      expect(p.fallbackDescription).not.toBeNull();
      expect(typeof p.fallbackDescription).toBe("string");
    }
  });

  it("brave fallback description mentions DuckDuckGo", () => {
    const brave = PROVIDERS.find((p) => p.id === "brave")!;
    expect(brave.fallbackDescription?.toLowerCase()).toContain("duckduckgo");
  });

  it("exa fallback description mentions MCP and does not claim DuckDuckGo is the fallback", () => {
    const exa = PROVIDERS.find((p) => p.id === "exa")!;
    expect(exa.fallbackDescription?.toLowerCase()).toContain("mcp");
    expect(exa.fallbackDescription?.toLowerCase()).not.toContain("duckduckgo");
  });

  it("twitter is an external-tool descriptor without API-key fields", () => {
    const twitter = getProvider("twitter");

    expect(twitter).toMatchObject({
      kind: "external-tool",
      id: "twitter",
      binary: "twitter",
      installCmd: "uv tool install twitter-cli",
      sessionSource: "browser-cookies",
    });
    expect("envVar" in twitter).toBe(false);
    expect("configPath" in twitter).toBe(false);
    expect("signupUrl" in twitter).toBe(false);
  });

  it("reddit is an external-tool descriptor without API-key fields", () => {
    const reddit = getProvider("reddit");

    expect(reddit).toMatchObject({
      kind: "external-tool",
      id: "reddit",
      binary: "rdt",
      installCmd: "uv tool install rdt-cli",
      sessionSource: "browser-cookies",
    });
    expect(isExternalToolProvider(reddit)).toBe(true);
    expect("envVar" in reddit).toBe(false);
    expect("configPath" in reddit).toBe(false);
    expect("signupUrl" in reddit).toBe(false);
  });

  it("yahoo is a public HTTP descriptor with a probe URL", () => {
    const descriptor = getProvider("yahoo");
    expect(descriptor.kind).toBe("public-http");
    expect(isPublicHttpProvider(descriptor)).toBe(true);
    if (isPublicHttpProvider(descriptor)) {
      expect(descriptor.probeUrl).toMatch(/^https:\/\//);
    }
    expect("envVar" in descriptor).toBe(false);
    expect("configPath" in descriptor).toBe(false);
  });

  it("polymarket is a public HTTP descriptor with a Gamma probe URL", () => {
    const descriptor = getProvider("polymarket");
    expect(descriptor.kind).toBe("public-http");
    expect(isPublicHttpProvider(descriptor)).toBe(true);
    if (isPublicHttpProvider(descriptor)) {
      expect(descriptor.probeUrl).toBe(
        "https://gamma-api.polymarket.com/public-search?q=fed%20rate%20cut&limit=1",
      );
    }
    expect("envVar" in descriptor).toBe(false);
    expect("configPath" in descriptor).toBe(false);
  });

  it("every alias is lowercase and argument-friendly", () => {
    for (const p of PROVIDERS) {
      for (const alias of p.aliases) {
        expect(alias).toBe(alias.toLowerCase());
        expect(alias).toMatch(/^[a-z0-9][a-z0-9 -]*$/);
      }
    }
  });

  it("aliases are unique across all providers", () => {
    const seen = new Map<string, ProviderId>();
    for (const p of PROVIDERS) {
      for (const alias of p.aliases) {
        const prior = seen.get(alias);
        expect(prior, `alias "${alias}" used by both ${prior} and ${p.id}`).toBeUndefined();
        seen.set(alias, p.id);
      }
    }
  });
});

describe("provider registry — lookup helpers", () => {
  it("listAllProviders returns the full array in declaration order", () => {
    expect(listAllProviders()).toEqual(PROVIDERS);
  });

  it("getProvider returns a descriptor for a valid id", () => {
    const p = getProvider("finnhub");
    expect(p.id).toBe("finnhub");
    expect(p.displayName).toBe("Finnhub");
  });

  it("getProvider returns the London Strategic Edge descriptor", () => {
    const provider = getProvider("lse");

    expect(provider).toMatchObject({
      id: "lse",
      kind: "api-key",
      displayName: "London Strategic Edge",
    });
  });

  it("getProvider throws for an unknown id", () => {
    expect(() => getProvider("not_a_provider" as ProviderId)).toThrow(/not_a_provider/);
  });

  it("getProvidersByCategory returns both exa and brave for web_search in declaration order", () => {
    const results = getProvidersByCategory("web_search");
    const ids = results.map((p) => p.id);
    expect(ids).toContain("exa");
    expect(ids).toContain("brave");
  });

  it("getProvidersByTier('hard') returns hard providers", () => {
    const ids = getProvidersByTier("hard")
      .map((p) => p.id)
      .sort();
    expect(ids).toEqual(["alpha_vantage", "coingecko", "fred", "polymarket", "sec_edgar", "yahoo"]);
  });

  it("getProvidersByTier('soft') returns soft enrichment providers", () => {
    const ids = getProvidersByTier("soft")
      .map((p) => p.id)
      .sort();
    expect(ids).toEqual([
      "brave",
      "ddg",
      "exa",
      "fear_greed",
      "finnhub",
      "lse",
      "reddit",
      "tradingview",
      "twitter",
    ]);
  });

  it("getProvidersByCategory returns sentiment providers", () => {
    const ids = getProvidersByCategory("sentiment").map((p) => p.id);
    expect(ids).toEqual(["fear_greed", "twitter", "reddit"]);
  });
});

describe("provider registry — credential helpers", () => {
  it("hasCredential returns true when getConfig has the field set", () => {
    vi.mocked(configModule.getConfig).mockReturnValue({
      ...DEFAULT_EMPTY_CONFIG,
      finnhubApiKey: "test-key-finnhub",
    } as any);
    expect(hasCredential("finnhub")).toBe(true);
  });

  it("hasCredential returns false when getConfig has no value for the provider", () => {
    // DEFAULT_EMPTY_CONFIG is in place from beforeEach.
    expect(hasCredential("finnhub")).toBe(false);
  });

  it("hasCredential reflects the resolved London Strategic Edge API key", () => {
    vi.mocked(configModule.getConfig).mockReturnValue({
      ...DEFAULT_EMPTY_CONFIG,
      lseApiKey: "test-key-lse",
    });

    expect(hasCredential("lse")).toBe(true);

    vi.mocked(configModule.getConfig).mockReturnValue(DEFAULT_EMPTY_CONFIG);
    expect(hasCredential("lse")).toBe(false);
  });

  it("getCredentialSource returns 'env' when the process env var is set", () => {
    process.env.ALPHA_VANTAGE_API_KEY = "test-key-av";
    expect(getCredentialSource("alpha_vantage")).toBe("env");
  });

  it("getCredentialSource returns 'absent' when neither env nor file is set", () => {
    // Mock loadFileConfig to return empty so we don't hit disk.
    vi.spyOn(configModule, "loadFileConfig").mockReturnValue({});
    expect(getCredentialSource("alpha_vantage")).toBe("absent");
  });

  it("getCredential returns the configured file key so local GUI forms can prefill it masked", () => {
    vi.spyOn(configModule, "loadFileConfig").mockReturnValue({
      providers: { fred: { apiKey: "fred-file-key" } },
    });

    expect(getCredential("fred")).toEqual({
      source: "file",
      value: "fred-file-key",
    });
  });

  it("getCredential prefers environment values over file config", () => {
    process.env.FRED_API_KEY = "fred-env-key";
    vi.spyOn(configModule, "loadFileConfig").mockReturnValue({
      providers: { fred: { apiKey: "fred-file-key" } },
    });

    expect(getCredential("fred")).toEqual({
      source: "env",
      value: "fred-env-key",
    });
  });

  it("credential helpers intentionally treat non-API-key providers as absent", () => {
    vi.spyOn(configModule, "loadFileConfig").mockReturnValue({
      providers: { twitter: { apiKey: "not-a-real-shape" } },
    });

    expect(hasCredential("twitter")).toBe(false);
    expect(getCredentialSource("twitter")).toBe("absent");
    expect(getCredential("twitter")).toEqual({ source: "absent" });
  });
});

describe("provider registry — resolveProviderFromArgument", () => {
  it("resolves an exact provider id to a single descriptor", () => {
    const result = resolveProviderFromArgument("alpha_vantage");
    expect(Array.isArray(result)).toBe(false);
    expect((result as { id: ProviderId }).id).toBe("alpha_vantage");
  });

  it("resolves a known alias to a single descriptor", () => {
    // "financials" is declared in Alpha Vantage's aliases.
    const result = resolveProviderFromArgument("financials");
    expect(Array.isArray(result)).toBe(false);
    expect((result as { id: ProviderId }).id).toBe("alpha_vantage");
  });

  it("resolves a multi-provider alias to an array (sub-picker case)", () => {
    const result = resolveProviderFromArgument("search");
    expect(Array.isArray(result)).toBe(true);
    const arr = result as ReadonlyArray<{ id: ProviderId }>;
    const ids = arr.map((p) => p.id).sort();
    expect(ids).toEqual(["brave", "ddg", "exa"]);
  });

  it("returns undefined for unknown argument", () => {
    expect(resolveProviderFromArgument("not_a_real_thing")).toBeUndefined();
  });

  it("is case-insensitive", () => {
    const result = resolveProviderFromArgument("Alpha_Vantage");
    expect(Array.isArray(result)).toBe(false);
    expect((result as { id: ProviderId }).id).toBe("alpha_vantage");
  });
});

describe("provider registry — import safety", () => {
  it("importing the registry does not call loadFileConfig at module evaluation time", async () => {
    // Intent: providers.ts uses loadFileConfig inside getCredentialSource, but
    // SHALL NOT invoke it at module evaluation time. An eager call would mean
    // any consumer importing the module pays a disk read just to list provider
    // metadata.
    vi.resetModules();
    vi.doMock("../../../src/config.js", () => ({
      loadFileConfig: vi.fn(() => ({})),
    }));
    const configModule = await import("../../../src/config.js");
    const loadFileConfigMock = configModule.loadFileConfig as ReturnType<typeof vi.fn>;
    // Freshly import the registry after the mock is in place.
    const providersModule = await import("../../../src/onboarding/providers.js");
    expect(providersModule.PROVIDERS.length).toBe(15);
    // Module evaluation must not trigger loadFileConfig.
    expect(loadFileConfigMock).not.toHaveBeenCalled();
    // Calling a credential helper SHOULD invoke loadFileConfig (lazy, on demand).
    providersModule.getCredentialSource("alpha_vantage");
    expect(loadFileConfigMock).toHaveBeenCalled();
    vi.doUnmock("../../../src/config.js");
  });
});
