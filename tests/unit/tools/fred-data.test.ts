import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "../../../src/config.js";
import { cache } from "../../../src/infra/cache.js";
import { fredDataTool } from "../../../src/tools/macro/fred-data.js";

const metaFixture = {
  seriess: [
    {
      id: "CPIAUCSL",
      title: "Consumer Price Index for All Urban Consumers: All Items in U.S. City Average",
      units: "Index 1982-1984=100",
      frequency: "Monthly",
      last_updated: "2026-05-12 08:03:57-05",
    },
  ],
};

const obsFixture = {
  observations: [
    { date: "2026-04-01", value: "332.407" },
    { date: "2026-03-01", value: "330.293" },
    { date: "2026-02-01", value: "327.46" },
    { date: "2026-01-01", value: "326.588" },
    { date: "2025-12-01", value: "326.031" },
    { date: "2025-11-01", value: "325.063" },
    { date: "2025-10-01", value: "." },
    { date: "2025-09-01", value: "324.245" },
    { date: "2025-08-01", value: "323.291" },
    { date: "2025-07-01", value: "322.169" },
    { date: "2025-06-01", value: "321.435" },
    { date: "2025-05-01", value: "320.62" },
    { date: "2025-04-01", value: "320.302" },
  ],
};

describe("fredDataTool", () => {
  const originalFetch = globalThis.fetch;
  const originalHome = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;

  beforeEach(() => {
    cache.clear();
    resetConfigCache();
    openCandleHome = mkdtempSync(join(tmpdir(), "oc-fred-tool-test-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
    writeFileSync(
      join(openCandleHome, "config.json"),
      JSON.stringify({ providers: { fred: { apiKey: "fred-test-key" } } }),
      "utf-8",
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetConfigCache();
    rmSync(openCandleHome, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalHome;
    }
    vi.restoreAllMocks();
  });

  it("includes derived YoY change for monthly index series when prior-year observation is available", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/series?")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(metaFixture) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(obsFixture) });
    });

    const result = await fredDataTool.execute("call-1", { series_id: "CPIAUCSL", limit: 13 });
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("Latest: 332.407 (2026-04-01)");
    expect(text).toContain("Derived YoY change: 3.78% (2025-04-01 to 2026-04-01).");
  });

  it("expands CPI requests to enough history for YoY even when a small limit is requested", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/series?")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(metaFixture) });
      }
      expect(url).toContain("limit=13");
      return Promise.resolve({ ok: true, json: () => Promise.resolve(obsFixture) });
    });

    const result = await fredDataTool.execute("call-1", { series_id: "CPIAUCSL", limit: 1 });
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("Derived YoY change: 3.78% (2025-04-01 to 2026-04-01).");
  });
});
