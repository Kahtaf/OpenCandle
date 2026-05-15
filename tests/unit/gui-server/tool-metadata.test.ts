import { afterEach, describe, expect, it, vi } from "vitest";
import * as configModule from "../../../src/config.js";
import { buildCatalog } from "../../../gui/server/tool-metadata.js";

describe("GUI tool metadata catalog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.FRED_API_KEY;
  });

  it("includes configured provider keys so the local GUI can render them masked", () => {
    vi.spyOn(configModule, "loadFileConfig").mockReturnValue({
      providers: { fred: { apiKey: "fred-file-key" } },
    });

    const fred = buildCatalog().providers.find((provider) => provider.id === "fred");

    expect(fred).toMatchObject({
      source: "file",
      apiKey: "fred-file-key",
    });
  });
});
