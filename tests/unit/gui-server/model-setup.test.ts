import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
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
  it("requires auth when the active model is not configured and no models are available", () => {
    const active = model("google", "gemini-2.5-flash");

    const state = buildModelSetupState(registry([]), active);

    expect(state.requirement).toBe("connect_auth");
    expect(state.currentModel).toBe("google/gemini-2.5-flash");
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
    const session = {
      modelRegistry: {
        ...registry([preferred]),
        authStorage: {
          set(provider: string, credential: unknown) {
            auth.set(provider, credential);
          },
        },
        find: () => preferred,
      },
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
