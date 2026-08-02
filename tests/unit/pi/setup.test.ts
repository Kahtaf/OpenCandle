import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/infra/open-url.js", async () => ({
  openInBrowser: vi.fn(async () => {}),
}));

import { guardModelRuntimeApiKeyLogins } from "../../../src/pi/model-key-login-guard.js";
import {
  getLlmSetupRequirement,
  runApiKeySetup,
  runOpenCandleSetup,
} from "../../../src/pi/setup.js";
import { createTestModelRuntime } from "../../helpers/pi-model-runtime.js";

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

describe("OpenCandle setup", () => {
  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.chdir(originalCwd);
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // NOTE: The finance-setup tests that used to live in this file covered the
  // `runFinanceSetup` flow that has been removed. New conversational-provider-setup
  // tests will land in Task Group 14 (auto-model-select) and Task Group 17 (e2e
  // for the full just-in-time flow).

  it("requires auth when there is no usable model", async () => {
    const { modelRegistry } = await createTestModelRuntime();

    expect(getLlmSetupRequirement({ model: undefined, modelRegistry })).toBe("connect_auth");
  });

  it("requires model selection when auth exists but no current model is usable", async () => {
    const { modelRegistry } = await createTestModelRuntime({
      anthropic: { type: "api_key", key: "sk-ant-test" },
    });

    expect(getLlmSetupRequirement({ model: undefined, modelRegistry })).toBe("select_model");
  });

  it("rejects a pasted model key and leaves the TUI ready to re-prompt", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("Forbidden", { status: 403 }),
    ) as unknown as typeof fetch;
    const { credentials, modelRuntime, modelRegistry } = await createTestModelRuntime();
    guardModelRuntimeApiKeyLogins(modelRuntime);
    const ui = createUi({ input: vi.fn().mockResolvedValue("bad-key") });
    const ctx = { ui, modelRegistry };

    await expect(runApiKeySetup(ctx as any, "openai", modelRuntime)).resolves.toBe(false);

    expect(await credentials.read("openai")).toBeUndefined();
    expect(ui.notify).toHaveBeenCalledWith(
      "Key was rejected by OpenAI. Paste a different key.",
      "error",
    );
  });

  it("does not save a pasted model key when verification cannot complete", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const { credentials, modelRuntime, modelRegistry } = await createTestModelRuntime();
    guardModelRuntimeApiKeyLogins(modelRuntime);
    const ui = createUi({ input: vi.fn().mockResolvedValue("unverified-key") });

    await expect(
      runApiKeySetup({ ui, modelRegistry } as any, "openai", modelRuntime),
    ).resolves.toBe(false);

    expect(await credentials.read("openai")).toBeUndefined();
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Couldn't verify"), "error");
  });

  it("writes an API key to Pi auth and auto-activates the default model without opening a picker", async () => {
    // 14.1 — with a defaultModelId that's available in getAvailable(), setModel should be
    // called exactly once without the model picker opening. The UI should receive only two
    // `select` calls total (choose entry method, choose provider).
    const { credentials, modelRuntime, modelRegistry } = await createTestModelRuntime();
    guardModelRuntimeApiKeyLogins(modelRuntime);
    const ui = createUi();
    ui.select.mockResolvedValueOnce("Paste API key").mockResolvedValueOnce("Google Gemini API");
    ui.input.mockResolvedValueOnce("test-google-key");

    const setModel = vi.fn().mockResolvedValue(true);
    const ctx = {
      hasUI: true,
      ui,
      modelRegistry,
      model: undefined,
      shutdown: vi.fn(),
    };

    const result = await runOpenCandleSetup(
      { setModel } as any,
      ctx as any,
      { mode: "manual" },
      modelRuntime,
    );

    expect(result).toBe("ready");
    expect(await credentials.read("google")).toEqual({ type: "api_key", key: "test-google-key" });
    expect(setModel).toHaveBeenCalledTimes(1);
    const activated = setModel.mock.calls[0]?.[0];
    expect(activated?.provider).toBe("google");
    expect(activated?.id).toBe("gemini-2.5-flash");
    // Only the entry-method and provider pickers — no model picker.
    expect(ui.select).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(globalThis.fetch)
        .mock.calls.filter(([url]) =>
          String(url).startsWith("https://generativelanguage.googleapis.com/v1beta/models"),
        ),
    ).toHaveLength(1);
  });

  it("falls back to the model picker when no default model is available for the provider", async () => {
    // 14.2 — if the registry lookup for (provider, defaultModelId) fails, the existing
    // picker path should still open. We force this by registering a fake provider that
    // has no default in our DEFAULT_LLM_MODELS map.
    const { credentials, modelRuntime, modelRegistry } = await createTestModelRuntime();
    // Register a throwaway provider with a single model whose id is NOT in our defaults.
    modelRuntime.registerProvider("custom-llm", {
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      apiKey: "fake",
      models: [
        {
          id: "custom-mystery-model",
          name: "Custom Mystery",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 4096,
          maxTokens: 1024,
        },
      ],
    });
    await credentials.modify("custom-llm", async () => ({ type: "api_key", key: "fake" }));
    await modelRuntime.refresh({ allowNetwork: false });

    const ui = createUi();
    // Directly invoke the picker path by starting from the "select_model" requirement.
    ui.select.mockResolvedValueOnce("custom-llm/custom-mystery-model");

    const setModel = vi.fn().mockResolvedValue(true);
    const ctx = {
      hasUI: true,
      ui,
      modelRegistry,
      model: undefined,
      shutdown: vi.fn(),
    };

    const result = await runOpenCandleSetup(
      { setModel } as any,
      ctx as any,
      { mode: "startup" },
      modelRuntime,
    );

    expect(result).toBe("ready");
    expect(setModel).toHaveBeenCalledTimes(1);
    // The select call was the model picker, not a setup entry.
    expect(ui.select.mock.calls[0]?.[0]).toBe("Choose a model");
  });

  it("first-run startup shows only LLM sign-in screens (no data-provider prompts)", async () => {
    // 14.3 — regression guard: after the finance-setup phase was removed, startup with
    // no model configured must not emit any data-provider picker. The first select call
    // must be the LLM entry-method picker.
    const { modelRuntime, modelRegistry } = await createTestModelRuntime();
    const ui = createUi({ select: vi.fn().mockResolvedValue("Exit setup") });
    const ctx = {
      hasUI: true,
      ui,
      modelRegistry,
      model: undefined,
      shutdown: vi.fn(),
    };

    await runOpenCandleSetup(
      { setModel: vi.fn() } as any,
      ctx as any,
      { mode: "startup" },
      modelRuntime,
    );

    // The first select call should be the LLM entry-method question.
    const firstSelectCall = ui.select.mock.calls[0];
    expect(String(firstSelectCall?.[0] ?? "")).toContain("Welcome to OpenCandle");
    // No prompt labeled with "finance", "data provider", "Alpha Vantage", or "FRED".
    for (const call of ui.select.mock.calls) {
      const label = String(call?.[0] ?? "");
      expect(label.toLowerCase()).not.toContain("finance");
      expect(label.toLowerCase()).not.toContain("alpha vantage");
      expect(label.toLowerCase()).not.toContain("fred");
    }
  });

  it("subsequent startup with LLM already configured shows zero setup screens", async () => {
    // 14.4 — when getLlmSetupRequirement returns "ready" and mode === "startup",
    // runOpenCandleSetup should short-circuit without touching ctx.ui at all.
    const { modelRuntime, modelRegistry } = await createTestModelRuntime({
      google: { type: "api_key", key: "pre-existing" },
    });
    const models = modelRegistry.getAvailable();
    const seeded = models.find((m) => m.provider === "google" && m.id === "gemini-2.5-flash");
    expect(seeded).toBeDefined();

    const ui = createUi();
    const setModel = vi.fn();
    const ctx = {
      hasUI: true,
      ui,
      modelRegistry,
      model: seeded,
      shutdown: vi.fn(),
    };

    const result = await runOpenCandleSetup(
      { setModel } as any,
      ctx as any,
      { mode: "startup" },
      modelRuntime,
    );

    expect(result).toBe("ready");
    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.input).not.toHaveBeenCalled();
    expect(ui.notify).not.toHaveBeenCalled();
    expect(setModel).not.toHaveBeenCalled();
  });

  it("uses OpenCandle-voiced input flow for API keys without rendering LoginDialogComponent", async () => {
    // 15.1 + 15.2 — API-key path must use ctx.ui.input directly and never render
    // LoginDialogComponent (which is instantiated inside ctx.ui.custom). The copy
    // surfaced to the user must reference OpenCandle so users understand where
    // the key is stored.
    const { modelRuntime, modelRegistry } = await createTestModelRuntime();
    const ui = createUi();
    ui.select.mockResolvedValueOnce("Paste API key").mockResolvedValueOnce("Anthropic API");
    ui.input.mockResolvedValueOnce("sk-ant-test-abc");

    const setModel = vi.fn().mockResolvedValue(true);
    const ctx = {
      hasUI: true,
      ui,
      modelRegistry,
      model: undefined,
      shutdown: vi.fn(),
    };

    const result = await runOpenCandleSetup(
      { setModel } as any,
      ctx as any,
      { mode: "manual" },
      modelRuntime,
    );

    expect(result).toBe("ready");
    // 15.1 — LoginDialogComponent is only invoked via ctx.ui.custom. API-key path
    // must never touch that surface.
    expect(ui.custom).not.toHaveBeenCalled();
    // 15.2 — OpenCandle-voiced copy surfaces the brand name in the notify/input
    // strings so users know where their key is being stored.
    const notifyStrings = ui.notify.mock.calls.map((call: any[]) => String(call[0] ?? ""));
    const inputStrings = ui.input.mock.calls.map((call: any[]) => String(call[0] ?? ""));
    const allCopy = [...notifyStrings, ...inputStrings].join("\n").toLowerCase();
    expect(allCopy).toContain("opencandle");
  });

  it("does not call ctx.ui.setHeader or setStatus anywhere in the setup flow", async () => {
    // 15.5 — renderSetupHeader / setSetupChrome / clearSetupChrome were deleted,
    // so the UI surface should never receive a header or a per-setup status string.
    const { modelRuntime, modelRegistry } = await createTestModelRuntime();
    const ui = createUi();
    ui.select.mockResolvedValueOnce("Paste API key").mockResolvedValueOnce("Google Gemini API");
    ui.input.mockResolvedValueOnce("test-google-key-2");

    const setModel = vi.fn().mockResolvedValue(true);
    const ctx = {
      hasUI: true,
      ui,
      modelRegistry,
      model: undefined,
      shutdown: vi.fn(),
    };

    await runOpenCandleSetup({ setModel } as any, ctx as any, { mode: "manual" }, modelRuntime);

    expect(ui.setHeader).not.toHaveBeenCalled();
    expect(ui.setStatus).not.toHaveBeenCalled();
  });

  it("exits startup setup cleanly when the user declines LLM setup", async () => {
    const { modelRuntime, modelRegistry } = await createTestModelRuntime();
    const ui = createUi({ select: vi.fn().mockResolvedValue("Exit setup") });
    const shutdown = vi.fn();
    const ctx = {
      hasUI: true,
      ui,
      modelRegistry,
      model: undefined,
      shutdown,
    };

    const result = await runOpenCandleSetup(
      { setModel: vi.fn() } as any,
      ctx as any,
      { mode: "startup" },
      modelRuntime,
    );

    expect(result).toBe("shutdown");
    expect(shutdown).toHaveBeenCalled();
  });
});
