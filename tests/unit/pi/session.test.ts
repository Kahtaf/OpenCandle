import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOpenCandleSession } from "../../../src/pi/session.js";
import { getOpenCandleToolDefinitions } from "../../../src/pi/tool-adapter.js";

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
    expect(result.session.getActiveToolNames()).toContain("ask_user");
    expect(result.session.getActiveToolNames()).not.toContain("trigger_twitter_login");
    expect(result.session.getActiveToolNames()).toHaveLength(
      getOpenCandleToolDefinitions().length + 1,
    );
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

  it("prefers the saved Pi default model over a resumed session model", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-session-model-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-session-model-sessions-"));
    try {
      const previous = SessionManager.create(cwd, sessionDir);
      previous.appendModelChange("google", "gemini-2.5-flash");
      previous.appendMessage({ role: "user", content: "old prompt" });
      previous.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "old response" }],
        api: "google-generative-ai",
        provider: "google",
        model: "gemini-2.5-flash",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      });

      const authStorage = AuthStorage.inMemory();
      authStorage.set("google", { type: "api_key", key: "test-key" });
      const modelRegistry = ModelRegistry.inMemory(authStorage);
      const settingsManager = SettingsManager.inMemory({
        defaultProvider: "google",
        defaultModel: "gemini-3.1-pro-preview",
      });

      const result = await createOpenCandleSession({
        cwd,
        authStorage,
        modelRegistry,
        settingsManager,
        sessionManager: SessionManager.continueRecent(cwd, sessionDir),
      });

      expect(result.session.model?.provider).toBe("google");
      expect(result.session.model?.id).toBe("gemini-3.1-pro-preview");

      result.session.dispose();
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});
