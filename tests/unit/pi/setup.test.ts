import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getLlmSetupRequirement, runVantageSetup } from "../../../src/pi/setup.js";

function createUi(overrides: Partial<any> = {}) {
  return {
    select: vi.fn(),
    input: vi.fn(),
    notify: vi.fn(),
    setHeader: vi.fn(),
    setStatus: vi.fn(),
    custom: vi.fn(),
    ...overrides,
  };
}

describe("Vantage setup", () => {
  const originalVantageHome = process.env.VANTAGE_HOME;

  afterEach(() => {
    if (originalVantageHome == null) {
      delete process.env.VANTAGE_HOME;
    } else {
      process.env.VANTAGE_HOME = originalVantageHome;
    }
    vi.restoreAllMocks();
  });

  it("requires auth when there is no usable model", () => {
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.inMemory(authStorage);

    expect(getLlmSetupRequirement({ model: undefined, modelRegistry })).toBe("connect_auth");
  });

  it("requires model selection when auth exists but no current model is usable", () => {
    const authStorage = AuthStorage.inMemory();
    authStorage.set("anthropic", { type: "api_key", key: "sk-ant-test" });
    const modelRegistry = ModelRegistry.inMemory(authStorage);

    expect(getLlmSetupRequirement({ model: undefined, modelRegistry })).toBe("select_model");
  });

  it("writes an API key to Pi auth and selects a model during manual setup", async () => {
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const ui = createUi();
    ui.select
      .mockResolvedValueOnce("Paste API key")
      .mockResolvedValueOnce("Google Gemini API")
      .mockResolvedValueOnce("google/gemini-2.5-flash");
    ui.input.mockResolvedValueOnce("test-google-key");

    const setModel = vi.fn().mockResolvedValue(true);
    const ctx = {
      hasUI: true,
      ui,
      modelRegistry,
      model: undefined,
      shutdown: vi.fn(),
    };

    const result = await runVantageSetup(
      { setModel } as any,
      ctx as any,
      { mode: "manual", forceFinancePrompt: false },
    );

    expect(result).toBe("ready");
    expect(authStorage.get("google")).toEqual({ type: "api_key", key: "test-google-key" });
    expect(setModel).toHaveBeenCalled();
  });

  it("writes finance keys to ~/.vantage/config.json after setup", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "vantage-setup-"));
    process.env.VANTAGE_HOME = tempDir;

    const authStorage = AuthStorage.inMemory({
      google: { type: "api_key", key: "test-google-key" },
    } as any);
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const currentModel = modelRegistry.getAvailable().find((model) => model.provider === "google");
    const ui = createUi();
    ui.select.mockResolvedValueOnce("Yes");
    ui.input.mockResolvedValueOnce("alpha-key").mockResolvedValueOnce("fred-key");

    const setModel = vi.fn().mockResolvedValue(true);
    const ctx = {
      hasUI: true,
      ui,
      modelRegistry,
      model: currentModel,
      shutdown: vi.fn(),
    };

    await runVantageSetup(
      { setModel } as any,
      ctx as any,
      { mode: "manual", forceFinancePrompt: true },
    );

    expect(readFileSync(join(tempDir, "config.json"), "utf-8")).toContain("alpha-key");
    expect(readFileSync(join(tempDir, "config.json"), "utf-8")).toContain("fred-key");
    expect(readFileSync(join(tempDir, "onboarding.json"), "utf-8")).toContain("completed");

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("exits startup setup cleanly when the user declines LLM setup", async () => {
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const ui = createUi({ select: vi.fn().mockResolvedValue("Exit setup") });
    const shutdown = vi.fn();
    const ctx = {
      hasUI: true,
      ui,
      modelRegistry,
      model: undefined,
      shutdown,
    };

    const result = await runVantageSetup(
      { setModel: vi.fn() } as any,
      ctx as any,
      { mode: "startup" },
    );

    expect(result).toBe("shutdown");
    expect(shutdown).toHaveBeenCalled();
  });
});
