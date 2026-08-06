import { describe, expect, it } from "vitest";
import { firstClassModelCatalog } from "../../../src/pi/model-catalog.generated.js";
import {
  createFirstClassModelProviders,
  listFirstClassModelCatalog,
  modelSetupProviders,
  resolveFirstClassModel,
} from "../../../src/pi/model-provider-catalog.js";

describe("first-class Pi model provider catalog", () => {
  it("derives every model from the installed Pi provider implementations", () => {
    const providers = createFirstClassModelProviders();
    const catalog = listFirstClassModelCatalog();

    expect(catalog).toHaveLength(77);
    expect(catalog).toEqual(
      providers.flatMap((provider) =>
        provider.getModels().map((model) => ({
          provider: model.provider,
          id: model.id,
          label: `${model.provider}/${model.id}`,
        })),
      ),
    );
    expect(firstClassModelCatalog).toEqual(catalog);
    expect(modelSetupProviders.map(({ id }) => id)).toEqual(["google", "openai", "anthropic"]);
  });

  it("resolves only provider-owned model ids and keeps defaults in the Pi catalog", () => {
    for (const setup of modelSetupProviders) {
      expect(resolveFirstClassModel(setup.defaultProvider, setup.defaultModel)).toMatchObject({
        provider: setup.defaultProvider,
        id: setup.defaultModel,
      });
    }
    expect(resolveFirstClassModel("openai", "claude-haiku-4-5")).toBeUndefined();
    expect(resolveFirstClassModel("unknown", "gpt-5-mini")).toBeUndefined();
  });
});
