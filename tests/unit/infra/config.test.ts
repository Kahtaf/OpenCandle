import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadConfig, loadEnv, loadFileConfig, saveFileConfig } from "../../../src/config.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

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
    expect(config).toEqual({
      alphaVantageApiKey: undefined,
      fredApiKey: undefined,
    });
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
      "utf-8",
    );
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
});
