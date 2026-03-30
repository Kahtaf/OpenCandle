import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadConfig, loadEnv } from "../../../src/config.js";
import { readFileSync } from "node:fs";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

const mockedReadFileSync = vi.mocked(readFileSync);

describe("loadEnv", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
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

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("returns finance-provider config without requiring LLM credentials", () => {
    mockedReadFileSync.mockReturnValue("OPENAI_API_KEY=my-key");
    const config = loadConfig();
    expect(config).toEqual({
      alphaVantageApiKey: undefined,
      fredApiKey: undefined,
    });
  });

  it("includes optional keys when present", () => {
    mockedReadFileSync.mockReturnValue(
      "OPENAI_API_KEY=openai\nALPHA_VANTAGE_API_KEY=av\nFRED_API_KEY=fred",
    );
    const config = loadConfig();
    expect(config.alphaVantageApiKey).toBe("av");
    expect(config.fredApiKey).toBe("fred");
  });

  it("optional keys are undefined when not set", () => {
    mockedReadFileSync.mockReturnValue("OPENAI_API_KEY=openai");
    delete process.env.ALPHA_VANTAGE_API_KEY;
    delete process.env.FRED_API_KEY;
    const config = loadConfig();
    expect(config.alphaVantageApiKey).toBeUndefined();
    expect(config.fredApiKey).toBeUndefined();
  });
});
