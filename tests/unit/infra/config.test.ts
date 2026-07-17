import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, loadEnv, loadFileConfig, saveFileConfig } from "../../../src/config.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  chmodSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const mockedChmodSync = vi.mocked(chmodSync);
const mockedExistsSync = vi.mocked(existsSync);
const mockedMkdirSync = vi.mocked(mkdirSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);

describe("loadEnv", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mockedExistsSync.mockReturnValue(false);
    mockedMkdirSync.mockImplementation(() => undefined);
  });

  it("parses key=value pairs from .env file", () => {
    mockedReadFileSync.mockReturnValue("OPENAI_API_KEY=test-key-123\nFRED_API_KEY=fred-456");
    loadEnv();
    expect(process.env.OPENAI_API_KEY).toBe("test-key-123");
    expect(process.env.FRED_API_KEY).toBe("fred-456");
  });

  it("does not override variables already exported in the environment", () => {
    process.env.OPENAI_API_KEY = "shell-key";
    mockedReadFileSync.mockReturnValue("OPENAI_API_KEY=dotenv-key\nFRED_API_KEY=fred-456");
    loadEnv();
    expect(process.env.OPENAI_API_KEY).toBe("shell-key");
    expect(process.env.FRED_API_KEY).toBe("fred-456");
  });

  it("ignores comment lines", () => {
    mockedReadFileSync.mockReturnValue("# This is a comment\nOPENAI_API_KEY=test-key");
    loadEnv();
    expect(process.env.OPENAI_API_KEY).toBe("test-key");
  });

  it("ignores empty lines", () => {
    mockedReadFileSync.mockReturnValue("\n\nOPENAI_API_KEY=test-key\n\n");
    loadEnv();
    expect(process.env.OPENAI_API_KEY).toBe("test-key");
  });

  it("handles values containing equals signs", () => {
    mockedReadFileSync.mockReturnValue("API_KEY=abc=def=ghi");
    loadEnv();
    expect(process.env.API_KEY).toBe("abc=def=ghi");
  });

  it("does not throw if .env file is missing", () => {
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(() => loadEnv()).not.toThrow();
  });
});

describe("loadConfig", () => {
  const originalEnv = { ...process.env };
  const openCandleHome = "/tmp/opencandle-config-test";
  const configPath = join(openCandleHome, "config.json");

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    process.env.OPENCANDLE_HOME = openCandleHome;
    mockedExistsSync.mockReturnValue(false);
    mockedMkdirSync.mockImplementation(() => undefined);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
  });

  it("returns finance-provider config without requiring LLM credentials", () => {
    mockedReadFileSync.mockReturnValue("OPENAI_API_KEY=my-key");
    const config = loadConfig();
    expect(config.alphaVantageApiKey).toBeUndefined();
    expect(config.fredApiKey).toBeUndefined();
    expect(config.sentiment).toBeDefined();
  });

  it("includes optional keys from .env when present", () => {
    mockedReadFileSync.mockImplementation((path) => {
      if (path === ".env") {
        return "OPENAI_API_KEY=openai\nALPHA_VANTAGE_API_KEY=av\nFRED_API_KEY=fred";
      }
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.alphaVantageApiKey).toBe("av");
    expect(config.fredApiKey).toBe("fred");
  });

  it("loads finance-provider keys from ~/.opencandle/config.json", () => {
    mockedExistsSync.mockImplementation((path) => path === configPath);
    mockedReadFileSync.mockImplementation((path) => {
      if (path === configPath) {
        return JSON.stringify({
          providers: {
            alphaVantage: { apiKey: "av-file" },
            fred: { apiKey: "fred-file" },
          },
        });
      }
      throw new Error("ENOENT");
    });

    const config = loadConfig();

    expect(config.alphaVantageApiKey).toBe("av-file");
    expect(config.fredApiKey).toBe("fred-file");
  });

  it("environment variables override ~/.opencandle/config.json", () => {
    mockedExistsSync.mockImplementation((path) => path === configPath);
    mockedReadFileSync.mockImplementation((path) => {
      if (path === configPath) {
        return JSON.stringify({
          providers: {
            alphaVantage: { apiKey: "av-file" },
            fred: { apiKey: "fred-file" },
          },
        });
      }
      throw new Error("ENOENT");
    });
    process.env.ALPHA_VANTAGE_API_KEY = "av-env";
    process.env.FRED_API_KEY = "fred-env";

    const config = loadConfig();

    expect(config.alphaVantageApiKey).toBe("av-env");
    expect(config.fredApiKey).toBe("fred-env");
  });

  it("optional keys are undefined when not set", () => {
    mockedReadFileSync.mockImplementation((path) => {
      if (path === ".env") {
        return "OPENAI_API_KEY=openai";
      }
      throw new Error("ENOENT");
    });
    delete process.env.ALPHA_VANTAGE_API_KEY;
    delete process.env.FRED_API_KEY;
    const config = loadConfig();
    expect(config.alphaVantageApiKey).toBeUndefined();
    expect(config.fredApiKey).toBeUndefined();
  });

  it("handles missing provider blocks in config.json", () => {
    mockedExistsSync.mockImplementation((path) => path === configPath);
    mockedReadFileSync.mockImplementation((path) => {
      if (path === configPath) {
        return JSON.stringify({ providers: { alphaVantage: {} } });
      }
      throw new Error("ENOENT");
    });

    const config = loadConfig();

    expect(config.alphaVantageApiKey).toBeUndefined();
    expect(config.fredApiKey).toBeUndefined();
  });

  it("throws a clear error for malformed ~/.opencandle/config.json", () => {
    mockedExistsSync.mockImplementation((path) => path === configPath);
    mockedReadFileSync.mockImplementation((path) => {
      if (path === configPath) {
        return "{";
      }
      throw new Error("ENOENT");
    });

    expect(() => loadConfig()).toThrowError(`Invalid OpenCandle config at ${configPath}`);
  });

  it("writes ~/.opencandle/config.json", () => {
    saveFileConfig(
      {
        providers: {
          alphaVantage: { apiKey: "av-file" },
          fred: { apiKey: "fred-file" },
        },
      },
      configPath,
    );

    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      configPath,
      `${JSON.stringify(
        {
          providers: {
            alphaVantage: { apiKey: "av-file" },
            fred: { apiKey: "fred-file" },
          },
        },
        null,
        2,
      )}\n`,
      { encoding: "utf-8", mode: 0o600 },
    );
    if (process.platform !== "win32") {
      expect(mockedChmodSync).toHaveBeenCalledWith(configPath, 0o600);
    }
  });

  it("loads config.json through the exported file reader", () => {
    mockedExistsSync.mockImplementation((path) => path === configPath);
    mockedReadFileSync.mockImplementation((path) => {
      if (path === configPath) {
        return JSON.stringify({
          providers: {
            alphaVantage: { apiKey: "av-file" },
          },
        });
      }
      throw new Error("ENOENT");
    });

    expect(loadFileConfig(configPath)).toEqual({
      providers: {
        alphaVantage: { apiKey: "av-file" },
      },
    });
  });

  it("ignores the retired OPENCANDLE_DEBATE flag and legacy debate file key", () => {
    process.env.OPENCANDLE_DEBATE = "false";
    mockedExistsSync.mockImplementation((path) => path === configPath);
    mockedReadFileSync.mockImplementation((path) => {
      if (path === configPath) return JSON.stringify({ debate: false });
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect("debate" in config).toBe(false);
    delete process.env.OPENCANDLE_DEBATE;
  });

  it("routerMode defaults to llm when OPENCANDLE_ROUTER_MODE is unset", () => {
    delete process.env.OPENCANDLE_ROUTER_MODE;
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.routerMode).toBe("llm");
  });

  it("routerMode defaults to llm when OPENCANDLE_ROUTER_MODE is blank", () => {
    process.env.OPENCANDLE_ROUTER_MODE = "";
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.routerMode).toBe("llm");
  });

  it("routerMode fails fast with migration guidance when set to rules", () => {
    process.env.OPENCANDLE_ROUTER_MODE = "rules";
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(() => loadConfig()).toThrowError(/OPENCANDLE_ROUTER_MODE="rules" was removed/);
  });

  it("routerMode rejects invalid OPENCANDLE_ROUTER_MODE values", () => {
    process.env.OPENCANDLE_ROUTER_MODE = "regex";
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(() => loadConfig()).toThrowError(
      'Invalid OPENCANDLE_ROUTER_MODE="regex". Allowed value: "llm" (default).',
    );
  });

  it("loads planning migration status overrides from OPENCANDLE_PLANNING_MIGRATION_STATUSES", () => {
    process.env.OPENCANDLE_PLANNING_MIGRATION_STATUSES =
      "single_asset_decision=dual_run,asset_compare=observe_only";
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.planningMigrationStatuses).toEqual({
      single_asset_decision: "dual_run",
      asset_compare: "observe_only",
    });
  });

  it("rejects invalid OPENCANDLE_PLANNING_MIGRATION_STATUSES values", () => {
    process.env.OPENCANDLE_PLANNING_MIGRATION_STATUSES = "single_asset_decision=regex";
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(() => loadConfig()).toThrowError(
      'Invalid OPENCANDLE_PLANNING_MIGRATION_STATUSES entry "single_asset_decision=regex".',
    );
  });

  it("loads braveApiKey from BRAVE_API_KEY env var", () => {
    process.env.BRAVE_API_KEY = "brave-env-key";
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.braveApiKey).toBe("brave-env-key");
    delete process.env.BRAVE_API_KEY;
  });

  it("loads braveApiKey from providers.brave.apiKey in config file", () => {
    delete process.env.BRAVE_API_KEY;
    mockedExistsSync.mockImplementation((path) => path === configPath);
    mockedReadFileSync.mockImplementation((path) => {
      if (path === configPath) {
        return JSON.stringify({
          providers: { brave: { apiKey: "brave-file-key" } },
        });
      }
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.braveApiKey).toBe("brave-file-key");
  });

  it("env var BRAVE_API_KEY overrides file config", () => {
    process.env.BRAVE_API_KEY = "brave-env-override";
    mockedExistsSync.mockImplementation((path) => path === configPath);
    mockedReadFileSync.mockImplementation((path) => {
      if (path === configPath) {
        return JSON.stringify({
          providers: { brave: { apiKey: "brave-file-key" } },
        });
      }
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.braveApiKey).toBe("brave-env-override");
    delete process.env.BRAVE_API_KEY;
  });

  it("braveApiKey is undefined when not configured", () => {
    delete process.env.BRAVE_API_KEY;
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.braveApiKey).toBeUndefined();
  });

  it("loads finnhubApiKey from FINNHUB_API_KEY env var", () => {
    process.env.FINNHUB_API_KEY = "finnhub-env-key";
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.finnhubApiKey).toBe("finnhub-env-key");
    delete process.env.FINNHUB_API_KEY;
  });

  it("loads finnhubApiKey from providers.finnhub.apiKey in config file", () => {
    delete process.env.FINNHUB_API_KEY;
    mockedExistsSync.mockImplementation((path) => path === configPath);
    mockedReadFileSync.mockImplementation((path) => {
      if (path === configPath) {
        return JSON.stringify({
          providers: { finnhub: { apiKey: "finnhub-file-key" } },
        });
      }
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.finnhubApiKey).toBe("finnhub-file-key");
  });

  it("env var FINNHUB_API_KEY overrides file config", () => {
    process.env.FINNHUB_API_KEY = "finnhub-env-override";
    mockedExistsSync.mockImplementation((path) => path === configPath);
    mockedReadFileSync.mockImplementation((path) => {
      if (path === configPath) {
        return JSON.stringify({
          providers: { finnhub: { apiKey: "finnhub-file-key" } },
        });
      }
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.finnhubApiKey).toBe("finnhub-env-override");
    delete process.env.FINNHUB_API_KEY;
  });

  it("finnhubApiKey is undefined when not configured", () => {
    delete process.env.FINNHUB_API_KEY;
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.finnhubApiKey).toBeUndefined();
  });

  it("loads lseApiKey from LSE_API_KEY env var", () => {
    process.env.LSE_API_KEY = "lse-env-key";
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.lseApiKey).toBe("lse-env-key");
    delete process.env.LSE_API_KEY;
  });

  it("loads lseApiKey from providers.lse.apiKey in config file", () => {
    delete process.env.LSE_API_KEY;
    mockedExistsSync.mockImplementation((path) => path === configPath);
    mockedReadFileSync.mockImplementation((path) => {
      if (path === configPath) {
        return JSON.stringify({
          providers: { lse: { apiKey: "lse-file-key" } },
        });
      }
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.lseApiKey).toBe("lse-file-key");
  });

  it("env var LSE_API_KEY overrides file config", () => {
    process.env.LSE_API_KEY = "lse-env-override";
    mockedExistsSync.mockImplementation((path) => path === configPath);
    mockedReadFileSync.mockImplementation((path) => {
      if (path === configPath) {
        return JSON.stringify({
          providers: { lse: { apiKey: "lse-file-key" } },
        });
      }
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.lseApiKey).toBe("lse-env-override");
    delete process.env.LSE_API_KEY;
  });

  describe("sentiment config", () => {
    it("sentiment defaults when not set", () => {
      delete process.env.OPENCANDLE_DEBATE;
      mockedExistsSync.mockReturnValue(false);
      mockedReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const config = loadConfig();
      expect(config.sentiment).toEqual({
        retentionDays: 30,
        defaultSubreddits: ["wallstreetbets", "stocks", "investing", "options"],
        commentsPerPost: 5,
        divergenceThreshold: 0.4,
        minUsefulSampleSize: 10,
        maxInsightDriversPerPolarity: 3,
        maxRepresentativeItemsPerSource: 5,
        maxAggregateRepresentativeItems: 8,
        maxNotableClaims: 5,
      });
    });

    it("sentiment reads from file config", () => {
      mockedExistsSync.mockImplementation((path) => path === configPath);
      mockedReadFileSync.mockImplementation((path) => {
        if (path === configPath) {
          return JSON.stringify({
            sentiment: {
              retentionDays: 14,
              defaultSubreddits: ["stocks"],
              commentsPerPost: 3,
              divergenceThreshold: 0.5,
            },
          });
        }
        throw new Error("ENOENT");
      });
      const config = loadConfig();
      expect(config.sentiment).toEqual({
        retentionDays: 14,
        defaultSubreddits: ["stocks"],
        commentsPerPost: 3,
        divergenceThreshold: 0.5,
        minUsefulSampleSize: 10,
        maxInsightDriversPerPolarity: 3,
        maxRepresentativeItemsPerSource: 5,
        maxAggregateRepresentativeItems: 8,
        maxNotableClaims: 5,
      });
    });

    it("sentiment partial file config merges with defaults", () => {
      mockedExistsSync.mockImplementation((path) => path === configPath);
      mockedReadFileSync.mockImplementation((path) => {
        if (path === configPath) {
          return JSON.stringify({ sentiment: { retentionDays: 7 } });
        }
        throw new Error("ENOENT");
      });
      const config = loadConfig();
      expect(config.sentiment?.retentionDays).toBe(7);
      expect(config.sentiment?.defaultSubreddits).toEqual([
        "wallstreetbets",
        "stocks",
        "investing",
        "options",
      ]);
      expect(config.sentiment?.commentsPerPost).toBe(5);
      expect(config.sentiment?.divergenceThreshold).toBe(0.4);
    });
  });
});
