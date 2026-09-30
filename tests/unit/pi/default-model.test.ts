import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSessionModelSelection } from "../../../src/pi/default-model.js";
import { createTestModelRuntime } from "../../helpers/pi-model-runtime.js";

describe("resolveSessionModelSelection", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const name of [
      "GEMINI_API_KEY",
      "GOOGLE_CLOUD_API_KEY",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_OAUTH_TOKEN",
    ]) {
      delete process.env[name];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reports a stored session's own model and thinking level", async () => {
    const { modelRuntime } = await createTestModelRuntime({
      google: { type: "api_key", key: "test-key" },
      openai: { type: "api_key", key: "test-key" },
    });
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendModelChange("openai", "gpt-5.5");
    sessionManager.appendThinkingLevelChange("high");

    const selection = resolveSessionModelSelection({
      modelRuntime,
      settingsManager: SettingsManager.inMemory({
        defaultProvider: "google",
        defaultModel: "gemini-2.5-flash",
        defaultThinkingLevel: "low",
      }),
      sessionManager,
    });

    expect(selection.model?.id).toBe("gpt-5.5");
    expect(selection.thinkingLevel).toBe("high");
    expect(selection.availableThinkingLevels).toContain("high");
  });

  it("falls back to the saved default when the session's model has no key", async () => {
    const { modelRuntime } = await createTestModelRuntime({
      google: { type: "api_key", key: "test-key" },
    });
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendModelChange("openai", "gpt-5.5");

    const selection = resolveSessionModelSelection({
      modelRuntime,
      settingsManager: SettingsManager.inMemory({
        defaultProvider: "google",
        defaultModel: "gemini-2.5-flash",
      }),
      sessionManager,
    });

    expect(selection.model?.provider).toBe("google");
    expect(selection.model?.id).toBe("gemini-2.5-flash");
  });

  it("reports no model when no provider has a key", async () => {
    const { modelRuntime } = await createTestModelRuntime();

    const selection = resolveSessionModelSelection({
      modelRuntime,
      settingsManager: SettingsManager.inMemory(),
      sessionManager: SessionManager.inMemory(),
    });

    expect(selection).toEqual({ thinkingLevel: "off", availableThinkingLevels: [] });
  });
});
