import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenCandleSession } from "../../../src/pi/session.js";
import { getOpenCandleToolDefinitions } from "../../../src/pi/tool-adapter.js";
import { createTestModelRuntime } from "../../helpers/pi-model-runtime.js";

describe("createOpenCandleSession", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("guards Pi API-key logins before creating the interactive session", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("Forbidden", { status: 403 }),
    ) as unknown as typeof fetch;
    const { credentials, modelRuntime } = await createTestModelRuntime();
    const result = await createOpenCandleSession({
      modelRuntime,
      settingsManager: SettingsManager.inMemory(),
      sessionManager: SessionManager.inMemory(),
      useInlineExtension: false,
    });

    await expect(
      modelRuntime.login("openai", "api_key", {
        prompt: vi.fn(async () => "bad-key"),
        notify: vi.fn(),
      }),
    ).rejects.toThrow("Key was rejected by OpenAI");
    expect(await credentials.read("openai")).toBeUndefined();

    result.session.dispose();
  });

  it("guards API-key login when Pi creates the model runtime", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("Forbidden", { status: 403 }),
    ) as unknown as typeof fetch;
    const agentDir = mkdtempSync(join(tmpdir(), "opencandle-login-guard-agent-"));
    try {
      const result = await createOpenCandleSession({
        agentDir,
        settingsManager: SettingsManager.inMemory(),
        sessionManager: SessionManager.inMemory(),
        useInlineExtension: false,
      });

      await expect(
        result.session.modelRuntime.login("openai", "api_key", {
          prompt: vi.fn(async () => "bad-key"),
          notify: vi.fn(),
        }),
      ).rejects.toThrow("Key was rejected by OpenAI");

      result.session.dispose();
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
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
    expect(result.coordinator).toBeDefined();
    await expect(result.waitForSettled()).resolves.toBeUndefined();
    if (result.modelFallbackMessage) {
      expect(result.modelFallbackMessage).toContain("No models available");
    }

    result.session.dispose();
  });

  it("surfaces Pi provider availability from environment variables without OpenCandle-specific auth wiring", async () => {
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.ANTHROPIC_API_KEY = "anthropic-key";

    const { modelRuntime } = await createTestModelRuntime();
    const available = await modelRuntime.getAvailable();

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

      const { modelRuntime } = await createTestModelRuntime({
        google: { type: "api_key", key: "test-key" },
      });
      const settingsManager = SettingsManager.inMemory({
        defaultProvider: "google",
        defaultModel: "gemini-3.1-pro-preview",
      });

      const result = await createOpenCandleSession({
        cwd,
        modelRuntime,
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
  describe("initial model when no model is saved", () => {
    const providerEnvVars = [
      "GEMINI_API_KEY",
      "GOOGLE_CLOUD_API_KEY",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_OAUTH_TOKEN",
    ];

    beforeEach(() => {
      for (const name of providerEnvVars) delete process.env[name];
    });

    it("uses the OpenCandle OpenAI default when only OPENAI_API_KEY is set", async () => {
      process.env.OPENAI_API_KEY = "env-openai-key";
      const { modelRuntime } = await createTestModelRuntime();

      const result = await createOpenCandleSession({
        modelRuntime,
        settingsManager: SettingsManager.inMemory(),
        sessionManager: SessionManager.inMemory(),
        useInlineExtension: false,
      });

      expect(result.session.model?.provider).toBe("openai");
      expect(result.session.model?.id).toBe("gpt-6-luna");
      result.session.dispose();
    });

    it.each([
      ["anthropic", "claude-haiku-4-5"],
      ["google", "gemini-2.5-flash"],
    ])(
      "uses the OpenCandle %s default for a stored key without a saved model",
      async (provider, modelId) => {
        const { modelRuntime } = await createTestModelRuntime({
          [provider]: { type: "api_key", key: "stored-key" },
        });

        const result = await createOpenCandleSession({
          modelRuntime,
          settingsManager: SettingsManager.inMemory(),
          sessionManager: SessionManager.inMemory(),
          useInlineExtension: false,
        });

        expect(result.session.model?.provider).toBe(provider);
        expect(result.session.model?.id).toBe(modelId);
        result.session.dispose();
      },
    );

    it("picks providers in setup order (Google, OpenAI, Anthropic) when several keys are set", async () => {
      process.env.OPENAI_API_KEY = "env-openai-key";
      process.env.ANTHROPIC_API_KEY = "env-anthropic-key";
      process.env.GEMINI_API_KEY = "env-gemini-key";
      const { modelRuntime } = await createTestModelRuntime();

      const result = await createOpenCandleSession({
        modelRuntime,
        settingsManager: SettingsManager.inMemory(),
        sessionManager: SessionManager.inMemory(),
        useInlineExtension: false,
      });

      expect(result.session.model?.provider).toBe("google");
      expect(result.session.model?.id).toBe("gemini-2.5-flash");
      result.session.dispose();
    });

    it("keeps an explicitly saved model over the OpenCandle default", async () => {
      process.env.OPENAI_API_KEY = "env-openai-key";
      const { modelRuntime } = await createTestModelRuntime();

      const result = await createOpenCandleSession({
        modelRuntime,
        settingsManager: SettingsManager.inMemory({
          defaultProvider: "openai",
          defaultModel: "gpt-5.5",
        }),
        sessionManager: SessionManager.inMemory(),
        useInlineExtension: false,
      });

      expect(result.session.model?.provider).toBe("openai");
      expect(result.session.model?.id).toBe("gpt-5.5");
      result.session.dispose();
    });

    it("keeps a model passed by the caller over the OpenCandle default", async () => {
      process.env.OPENAI_API_KEY = "env-openai-key";
      const { modelRuntime } = await createTestModelRuntime();
      const explicit = modelRuntime.getModel("openai", "gpt-5.5");
      expect(explicit).toBeDefined();

      const result = await createOpenCandleSession({
        modelRuntime,
        model: explicit,
        settingsManager: SettingsManager.inMemory(),
        sessionManager: SessionManager.inMemory(),
        useInlineExtension: false,
      });

      expect(result.session.model?.id).toBe("gpt-5.5");
      result.session.dispose();
    });

    it("keeps the model recorded in a resumed session", async () => {
      process.env.OPENAI_API_KEY = "env-openai-key";
      const cwd = mkdtempSync(join(tmpdir(), "opencandle-default-model-cwd-"));
      const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-default-model-sessions-"));
      try {
        const previous = SessionManager.create(cwd, sessionDir);
        previous.appendModelChange("openai", "gpt-5.5");
        previous.appendMessage({ role: "user", content: "old prompt", timestamp: Date.now() });
        previous.appendMessage({
          role: "assistant",
          content: [{ type: "text", text: "old response" }],
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5.5",
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
        const { modelRuntime } = await createTestModelRuntime();

        const result = await createOpenCandleSession({
          cwd,
          modelRuntime,
          settingsManager: SettingsManager.inMemory(),
          sessionManager: SessionManager.continueRecent(cwd, sessionDir),
          useInlineExtension: false,
        });

        expect(result.session.model?.id).toBe("gpt-5.5");
        result.session.dispose();
      } finally {
        await rm(cwd, { recursive: true, force: true });
        await rm(sessionDir, { recursive: true, force: true });
      }
    });

    it("falls back to the OpenCandle default when a resumed session model has no auth", async () => {
      process.env.OPENAI_API_KEY = "env-openai-key";
      const cwd = mkdtempSync(join(tmpdir(), "opencandle-default-model-cwd-"));
      const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-default-model-sessions-"));
      try {
        const previous = SessionManager.create(cwd, sessionDir);
        previous.appendModelChange("google", "gemini-2.5-flash");
        previous.appendMessage({ role: "user", content: "old prompt", timestamp: Date.now() });
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
        const { modelRuntime } = await createTestModelRuntime();

        const result = await createOpenCandleSession({
          cwd,
          modelRuntime,
          settingsManager: SettingsManager.inMemory(),
          sessionManager: SessionManager.continueRecent(cwd, sessionDir),
          useInlineExtension: false,
        });

        expect(result.session.model?.provider).toBe("openai");
        expect(result.session.model?.id).toBe("gpt-6-luna");
        expect(result.modelFallbackMessage).toBe(
          "Could not restore model google/gemini-2.5-flash. Using openai/gpt-6-luna",
        );
        result.session.dispose();
      } finally {
        await rm(cwd, { recursive: true, force: true });
        await rm(sessionDir, { recursive: true, force: true });
      }
    });
  });
});
