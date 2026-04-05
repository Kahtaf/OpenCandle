import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { createOpenCandleSession } from "../../../src/pi/session.js";

describe("createOpenCandleSession", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("starts in finance-only mode and loads the bundled OpenCandle extension", async () => {
    process.env.GEMINI_API_KEY = "";
    process.env.OPENAI_API_KEY = "";
    process.env.ANTHROPIC_API_KEY = "";

    const result = await createOpenCandleSession({
      cwd: process.cwd(),
      settingsManager: SettingsManager.inMemory(),
      sessionManager: SessionManager.inMemory(),
    });

    expect(result.session.getActiveToolNames()).not.toContain("read");
    expect(result.session.getActiveToolNames()).not.toContain("bash");
    expect(result.session.getActiveToolNames()).toContain("get_stock_quote");
    expect(result.session.getActiveToolNames()).toContain("manage_watchlist");
    expect(result.session.getActiveToolNames()).toHaveLength(26);
    expect(result.session.getAllTools().some((tool) => tool.name === "read")).toBe(true);
    if (result.modelFallbackMessage) {
      expect(result.modelFallbackMessage).toContain("No models available");
    }

    result.session.dispose();
  });

  it("surfaces Pi provider availability from environment variables without OpenCandle-specific auth wiring", async () => {
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.ANTHROPIC_API_KEY = "anthropic-key";

    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const available = await modelRegistry.getAvailable();

    expect(available.some((model) => model.provider === "google")).toBe(true);
    expect(available.some((model) => model.provider === "openai")).toBe(true);
    expect(available.some((model) => model.provider === "anthropic")).toBe(true);
  });
});
