import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  buildModelSetupState,
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
});
