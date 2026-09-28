import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { buildCliModelSetupState } from "../../../src/doctor/cli-command.js";

function model(provider: string, id: string): Model<Api> {
  return { provider, id, name: id } as unknown as Model<Api>;
}

function settings(provider?: string, modelId?: string) {
  return {
    getDefaultProvider: () => provider,
    getDefaultModel: () => modelId,
  };
}

describe("doctor CLI model setup projection", () => {
  it("requires auth when Pi exposes only unauthenticated catalog models", () => {
    const catalogModel = model("openai", "gpt-5-mini");
    const registry = {
      refresh: () => {},
      find: () => catalogModel,
      getAvailable: () => [catalogModel],
      hasConfiguredAuth: () => false,
    };

    expect(
      buildCliModelSetupState(registry as never, settings("openai", "gpt-5-mini") as never),
    ).toEqual({
      requirement: "connect_auth",
      currentModel: undefined,
      availableModels: [],
    });
  });

  it("includes authenticated OAuth models outside API-key setup providers", () => {
    const oauthModel = model("openai-codex", "gpt-5.4");
    const registry = {
      refresh: () => {},
      find: () => undefined,
      getAvailable: () => [oauthModel],
      hasConfiguredAuth: (candidate: Model<Api>) => candidate === oauthModel,
    };

    expect(buildCliModelSetupState(registry as never, settings() as never)).toEqual({
      requirement: "select_model",
      currentModel: undefined,
      availableModels: [{ provider: "openai-codex", id: "gpt-5.4", label: "openai-codex/gpt-5.4" }],
    });
  });
  it("reports the OpenCandle provider default as ready when no model is saved", () => {
    const luna = model("openai", "gpt-6-luna");
    const other = model("openai", "gpt-5.5");
    const registry = {
      refresh: () => {},
      find: (provider: string, id: string) =>
        [luna, other].find((candidate) => candidate.provider === provider && candidate.id === id),
      getAvailable: () => [other, luna],
      hasConfiguredAuth: (candidate: Model<Api>) => candidate.provider === "openai",
    };

    expect(buildCliModelSetupState(registry as never, settings() as never)).toEqual({
      requirement: "ready",
      currentModel: "openai/gpt-6-luna",
    });
  });
});
