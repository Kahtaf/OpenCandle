import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCatalog } from "../../../gui/server/tool-metadata.js";
import * as configModule from "../../../src/config.js";

describe("GUI tool metadata catalog", () => {
  const originalOpenCandleHome = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;

  beforeEach(() => {
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-tool-metadata-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.FRED_API_KEY;
    if (originalOpenCandleHome == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalOpenCandleHome;
    }
    rmSync(openCandleHome, { recursive: true, force: true });
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
