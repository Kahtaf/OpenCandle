import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCatalog } from "../../../gui/server/tool-metadata.js";
import * as configModule from "../../../src/config.js";
import {
  markProviderNeverAsk,
  markProviderSnoozed,
  saveOnboardingState,
} from "../../../src/onboarding/state.js";

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

  it("serializes configured providers as status plus masked hint, never the raw key", () => {
    vi.spyOn(configModule, "loadFileConfig").mockReturnValue({
      providers: { fred: { apiKey: "fred-file-key" } },
    });

    const catalog = buildCatalog();
    const fred = catalog.providers.find((provider) => provider.id === "fred");

    expect(fred).toMatchObject({
      source: "file",
      configured: true,
      maskedKeyHint: "…-key",
    });
    expect(fred).not.toHaveProperty("apiKey");
    expect(JSON.stringify(catalog)).not.toContain("fred-file-key");
  });

  it("marks unconfigured API-key providers as not configured without a hint", () => {
    const fred = buildCatalog().providers.find((provider) => provider.id === "fred");

    expect(fred).toMatchObject({ source: "absent", configured: false });
    expect(fred?.maskedKeyHint).toBeUndefined();
  });

  it("serializes non-key providers without API-key setup fields", () => {
    const catalog = buildCatalog();

    expect(catalog.providers.find((provider) => provider.id === "twitter")).toMatchObject({
      id: "twitter",
      kind: "external-tool",
      binary: "twitter",
      installCmd: "uv tool install twitter-cli",
      status: "unknown",
    });
    expect(catalog.providers.find((provider) => provider.id === "twitter")).not.toHaveProperty(
      "envVar",
    );
    expect(catalog.providers.find((provider) => provider.id === "twitter")).not.toHaveProperty(
      "apiKey",
    );

    expect(catalog.providers.find((provider) => provider.id === "yahoo")).toMatchObject({
      id: "yahoo",
      kind: "public-http",
      status: "unknown",
      probeUrl: expect.stringMatching(/^https:\/\//),
    });
  });

  it("carries the onboarding skip state so a settings row can say which it is", () => {
    saveOnboardingState(
      markProviderNeverAsk(
        markProviderSnoozed({ version: 2, providers: {} }, "brave", 7),
        "reddit",
      ),
    );

    const providers = buildCatalog().providers;
    const brave = providers.find((provider) => provider.id === "brave");
    const reddit = providers.find((provider) => provider.id === "reddit");
    const fred = providers.find((provider) => provider.id === "fred");

    expect(brave?.onboarding).toMatchObject({
      status: "snoozed",
      snoozeUntil: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(reddit?.onboarding).toEqual({ status: "never_ask" });
    expect(fred?.onboarding).toBeUndefined();
  });

  it("surfaces skipped external-tool providers from onboarding preferences", () => {
    saveOnboardingState(markProviderNeverAsk({ version: 2, providers: {} }, "twitter"));

    const twitter = buildCatalog().providers.find((provider) => provider.id === "twitter");

    expect(twitter).toMatchObject({
      id: "twitter",
      kind: "external-tool",
      status: "skipped",
      statusDetail: {
        state: "skipped",
        message: expect.stringContaining("opencandle doctor --enable twitter"),
      },
    });
  });
});
