import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configModule from "../../../src/config.js";
import {
  getCredential,
  getCredentialSource,
  getProvider,
  getProvidersByCategory,
  getProvidersByTier,
  hasCredential,
  listAllProviders,
  PROVIDERS,
  type ProviderId,
  resolveProviderFromArgument,
} from "../../../src/onboarding/providers.js";

const ENV_KEYS = [
  "ALPHA_VANTAGE_API_KEY",
  "FRED_API_KEY",
  "FINNHUB_API_KEY",
  "BRAVE_API_KEY",
  "EXA_API_KEY",
] as const;

const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
const DEFAULT_EMPTY_CONFIG = {
  alphaVantageApiKey: undefined,
  fredApiKey: undefined,
  braveApiKey: undefined,
  exaApiKey: undefined,
  finnhubApiKey: undefined,
  debate: true,
  sentiment: undefined,
};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
  // Default: empty config so hasCredential returns false unless a test overrides.
  vi.spyOn(configModule, "getConfig").mockReturnValue(DEFAULT_EMPTY_CONFIG as any);
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
  it("contains exactly five credentialed providers with stable ids", () => {
    const ids = PROVIDERS.map((p) => p.id).sort();
    expect(ids).toEqual(["alpha_vantage", "brave", "exa", "finnhub", "fred"].sort());
  });

  it("every descriptor has all required fields", () => {
    for (const p of PROVIDERS) {
      expect(p.id).toBeTruthy();
      expect(p.displayName).toBeTruthy();
      expect(["fundamentals", "macro", "news", "web_search"]).toContain(p.category);
      expect(["hard", "soft"]).toContain(p.tier);
      expect(Array.isArray(p.aliases)).toBe(true);
      expect(p.aliases.length).toBeGreaterThan(0);
      expect(p.signupUrl).toMatch(/^https:\/\//);
      expect(typeof p.freeTier).toBe("boolean");
      expect(p.envVar).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(p.configPath.length).toBeGreaterThan(0);
      expect(Array.isArray(p.unlocks)).toBe(true);
      expect(p.unlocks.length).toBeGreaterThan(0);
      expect(p.snoozeDurationDays).toBeGreaterThan(0);
      expect(p.instructionsHint).toBeTruthy();
      // fallbackDescription may be null or string, never undefined
      expect(p.fallbackDescription === null || typeof p.fallbackDescription === "string").toBe(
        true,
      );
    }
  });

  it("hard-tier providers are alpha_vantage and fred, both with null fallback", () => {
    const hard = PROVIDERS.filter((p) => p.tier === "hard");
    expect(hard.map((p) => p.id).sort()).toEqual(["alpha_vantage", "fred"]);
    for (const p of hard) {
      expect(p.fallbackDescription).toBeNull();
    }
  });

  it("soft-tier providers are finnhub, brave, exa, all with non-null fallback description", () => {
    const soft = PROVIDERS.filter((p) => p.tier === "soft");
    expect(soft.map((p) => p.id).sort()).toEqual(["brave", "exa", "finnhub"]);
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

  it("every alias is lowercase kebab-case-friendly", () => {
    for (const p of PROVIDERS) {
      for (const alias of p.aliases) {
        expect(alias).toBe(alias.toLowerCase());
        expect(alias).toMatch(/^[a-z0-9][a-z0-9-]*$/);
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

  it("getProvider throws for an unknown id", () => {
    expect(() => getProvider("not_a_provider" as ProviderId)).toThrow(/not_a_provider/);
  });

  it("getProvidersByCategory returns both exa and brave for web_search in declaration order", () => {
    const results = getProvidersByCategory("web_search");
    const ids = results.map((p) => p.id);
    expect(ids).toContain("exa");
    expect(ids).toContain("brave");
  });

  it("getProvidersByTier('hard') returns alpha_vantage and fred", () => {
    const ids = getProvidersByTier("hard")
      .map((p) => p.id)
      .sort();
    expect(ids).toEqual(["alpha_vantage", "fred"]);
  });

  it("getProvidersByTier('soft') returns finnhub, brave, exa", () => {
    const ids = getProvidersByTier("soft")
      .map((p) => p.id)
      .sort();
    expect(ids).toEqual(["brave", "exa", "finnhub"]);
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
    expect(ids).toEqual(["brave", "exa"]);
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
    expect(providersModule.PROVIDERS.length).toBe(5);
    // Module evaluation must not trigger loadFileConfig.
    expect(loadFileConfigMock).not.toHaveBeenCalled();
    // Calling a credential helper SHOULD invoke loadFileConfig (lazy, on demand).
    providersModule.getCredentialSource("alpha_vantage");
    expect(loadFileConfigMock).toHaveBeenCalled();
    vi.doUnmock("../../../src/config.js");
  });
});
