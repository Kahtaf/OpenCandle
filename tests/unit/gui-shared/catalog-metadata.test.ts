import { describe, expect, it } from "vitest";
import {
  providerCatalogBase,
  serializeApiKeyProviderCatalog,
} from "../../../gui/shared/catalog-metadata.js";
import { getProvider } from "../../../src/onboarding/providers.js";

describe("shared provider catalog metadata", () => {
  it("preserves canonical aliases and masks API-key state without exposing the key", () => {
    const provider = getProvider("fred");
    if (provider.kind !== "api-key") throw new Error("Expected FRED to require an API key");

    const entry = serializeApiKeyProviderCatalog(provider, {
      source: "env",
      credential: "test-fred-secret",
    });

    expect(entry).toMatchObject({
      id: "fred",
      displayName: "FRED",
      aliases: expect.arrayContaining(["macro"]),
      source: "env",
      configured: true,
      maskedKeyHint: "…cret",
    });
    expect(JSON.stringify(entry)).not.toContain("test-fred-secret");
    expect(providerCatalogBase(provider)).not.toHaveProperty("envVar");
  });
});
