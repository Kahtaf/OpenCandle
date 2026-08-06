import type { Api, Model } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildModelSetupState,
  createModelSetupController,
  findPreferredModel,
  type ModelSetupRegistry,
  modelSetupProviders,
} from "../../../gui/server/model-setup.js";

function model(provider: string, id: string): Model<Api> {
  return { provider, id, name: id } as unknown as Model<Api>;
}

function registry(available: Model<Api>[], configured = new Set<string>()): ModelSetupRegistry {
  return {
    refresh() {},
    getAvailable() {
      return available;
    },
    hasConfiguredAuth(candidate) {
      return configured.has(`${candidate.provider}/${candidate.id}`);
    },
  };
}

describe("GUI model setup", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requires auth when the active model is not configured and no models are available", () => {
    const active = model("google", "gemini-2.5-flash");

    const state = buildModelSetupState(registry([]), active);

    expect(state.requirement).toBe("connect_auth");
    // The placeholder model has no usable credentials, so it must not be
    // reported as the current model (the composer would render its raw id).
    expect(state.currentModel).toBeUndefined();
    expect(state.providers.map((provider) => provider.envVar)).toEqual([
      "GEMINI_API_KEY",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
    ]);
  });

  it("asks the user to select a model when credentials already expose available models", () => {
    const available = [model("openai", "gpt-5-mini")];

    const state = buildModelSetupState(registry(available), undefined);

    expect(state.requirement).toBe("select_model");
    expect(state.availableModels).toEqual([
      { provider: "openai", id: "gpt-5-mini", label: "openai/gpt-5-mini" },
    ]);
  });

  it("is ready when the active model has configured auth", () => {
    const active = model("anthropic", "claude-haiku-4-5");

    const state = buildModelSetupState(
      registry([active], new Set(["anthropic/claude-haiku-4-5"])),
      active,
    );

    expect(state.requirement).toBe("ready");
  });

  it("projects Pi thinking controls into the shared model setup state", () => {
    const active = model("openai", "gpt-5-mini");

    const state = buildModelSetupState(registry([active], new Set(["openai/gpt-5-mini"])), active, {
      current: "medium",
      available: ["off", "low", "medium", "high"],
    });

    expect(state).toMatchObject({
      currentThinkingLevel: "medium",
      availableThinkingLevels: ["off", "low", "medium", "high"],
    });
  });

  it("sets thinking through Pi and flushes its canonical settings", async () => {
    const setThinkingLevel = vi.fn();
    const flush = vi.fn(async () => undefined);
    const controller = createModelSetupController({
      role: "writer",
      getSession: () =>
        ({
          modelRuntime: {},
          getAvailableThinkingLevels: () => ["off", "high"],
          setThinkingLevel,
          settingsManager: { flush },
        }) as never,
      getSessionManager: () => ({ appendCustomMessageEntry: vi.fn() }),
      broadcastState: vi.fn(),
    });

    await controller.handleSetThinkingLevel?.("high");

    expect(setThinkingLevel).toHaveBeenCalledWith("high");
    expect(flush).toHaveBeenCalledOnce();
  });

  it("prefers the provider default model after saving an API key", () => {
    const google = modelSetupProviders.find((provider) => provider.id === "google");
    if (!google) throw new Error("Missing google provider setup");
    const fallback = model("google", "gemini-2.0-flash");
    const preferred = model("google", "gemini-2.5-flash");

    const selected = findPreferredModel(registry([fallback, preferred]), google);

    expect(selected).toBe(preferred);
  });

  it("saves a model API key, selects the preferred model, and records setup state", async () => {
    const preferred = model("google", "gemini-2.5-flash");
    const entries: unknown[] = [];
    const selectedModels: Model<Api>[] = [];
    const auth = new Map<string, unknown>();
    const modelRuntime = {
      login: async (
        provider: string,
        _type: string,
        interaction: { prompt(input: unknown): Promise<string> },
      ) => {
        auth.set(provider, { type: "api_key", key: await interaction.prompt({}) });
      },
      getAvailableSnapshot: () => [preferred],
      hasConfiguredAuth: () => true,
      getModel: () => preferred,
      refresh: async () => {},
    };
    const session = {
      modelRuntime,
      setModel: async (selected: Model<Api>) => {
        selectedModels.push(selected);
      },
      settingsManager: {
        flush: async () => {},
      },
    };
    const controller = createModelSetupController({
      role: "writer",
      getSession: () => session,
      getSessionManager: () => ({
        appendCustomMessageEntry: (...args: unknown[]) => {
          entries.push(args);
        },
      }),
      broadcastState: () => {},
    });

    await controller.handleSaveModelApiKey("google", " gem-key ");

    expect(auth.get("google")).toEqual({ type: "api_key", key: "gem-key" });
    expect(selectedModels).toEqual([preferred]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual([
      "opencandle-model-setup",
      "Connected Google Gemini and selected google/gemini-2.5-flash.",
      true,
      { source: "gui", provider: "google", model: "google/gemini-2.5-flash" },
    ]);
  });

  it("does not save a model key rejected by its provider", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("Unauthorized", { status: 401 }),
    ) as unknown as typeof fetch;
    const auth = new Map<string, unknown>();
    const session = {
      modelRuntime: {
        login: async () => {},
        getAvailableSnapshot: () => [model("openai", "gpt-5-mini")],
        hasConfiguredAuth: () => true,
        getModel: () => model("openai", "gpt-5-mini"),
        refresh: async () => {},
      },
      setModel: async () => {},
      settingsManager: { flush: async () => {} },
    };
    const controller = createModelSetupController({
      role: "writer",
      getSession: () => session,
      getSessionManager: () => ({ appendCustomMessageEntry: () => {} }),
      broadcastState: () => {},
    });

    await expect(controller.handleSaveModelApiKey("openai", "bad-key")).rejects.toThrow(
      "Key was rejected by OpenAI",
    );
    expect(auth).toHaveLength(0);
  });

  it("does not save a model key when its probe has a network failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const anthropic = model("anthropic", "claude-haiku-4-5");
    const login = vi.fn(async () => {});
    const session = {
      modelRuntime: {
        login,
        getAvailableSnapshot: () => [anthropic],
        hasConfiguredAuth: () => true,
        getModel: () => anthropic,
        refresh: async () => {},
      },
      setModel: async () => {},
      settingsManager: { flush: async () => {} },
    };
    const controller = createModelSetupController({
      role: "writer",
      getSession: () => session,
      getSessionManager: () => ({ appendCustomMessageEntry: vi.fn() }),
      broadcastState: () => {},
    });

    await expect(controller.handleSaveModelApiKey("anthropic", "network-key")).rejects.toThrow(
      "Couldn't verify",
    );

    expect(login).not.toHaveBeenCalled();
  });

  it("does not advertise or record a provider key when its shared probe cannot verify it", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const appendCustomMessageEntry = vi.fn();
    const broadcastState = vi.fn();
    const controller = createModelSetupController({
      role: "writer",
      // Provider admission must fail before it can touch the Pi session.
      getSession: () => {
        throw new Error("provider validation must not access the session");
      },
      getSessionManager: () => ({ appendCustomMessageEntry }),
      broadcastState,
    });

    await expect(controller.handleSaveProviderApiKey("fred", "unverified-key")).rejects.toThrow(
      "Couldn't verify the FRED key",
    );

    expect(appendCustomMessageEntry).not.toHaveBeenCalled();
    expect(broadcastState).not.toHaveBeenCalled();
  });

  it("rejects model selection in follower mode", async () => {
    const controller = createModelSetupController({
      role: "follower",
      getSession: () => {
        throw new Error("should not read session");
      },
      getSessionManager: () => {
        throw new Error("should not read session manager");
      },
      broadcastState: () => {},
    });

    await expect(controller.handleSelectModel("google", "gemini-2.5-flash")).rejects.toThrow(
      "Read-only follower mode",
    );
  });
});
