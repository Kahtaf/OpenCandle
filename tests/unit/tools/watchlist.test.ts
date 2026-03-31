import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { watchlistTool } from "../../../src/tools/portfolio/watchlist.js";
import * as fs from "node:fs";
import { join } from "node:path";
import { getQuote } from "../../../src/providers/yahoo-finance.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
}));

describe("watchlistTool", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  const openCandleHome = "/tmp/opencandle-watchlist-test";

  beforeEach(() => {
    process.env.OPENCANDLE_HOME = openCandleHome;
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.readFileSync).mockReturnValue("[]");
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(getQuote).mockResolvedValue({ price: 180 } as any);
  });

  afterEach(() => {
    if (originalEnv == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalEnv;
    }
    vi.restoreAllMocks();
  });

  it("has correct tool metadata", () => {
    expect(watchlistTool.name).toBe("manage_watchlist");
    expect(watchlistTool.label).toBeTruthy();
    expect(watchlistTool.description).toBeTruthy();
  });

  it("adds a symbol to the watchlist", async () => {
    const result = await watchlistTool.execute("test", {
      action: "add",
      symbol: "AAPL",
      target_price: 200,
      stop_price: 150,
    });

    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(vi.mocked(fs.writeFileSync).mock.calls[0][0]).toBe(
      join(openCandleHome, "watchlist.json"),
    );
    const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
    expect(written).toHaveLength(1);
    expect(written[0].symbol).toBe("AAPL");
    expect(written[0].targetPrice).toBe(200);
    expect(written[0].stopPrice).toBe(150);
    expect(result.content[0].text).toContain("AAPL");
  });

  it("removes a symbol from the watchlist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([{ symbol: "AAPL", addedAt: "2024-01-01" }]),
    );

    const result = await watchlistTool.execute("test", {
      action: "remove",
      symbol: "AAPL",
    });

    const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
    expect(written).toHaveLength(0);
    expect(result.content[0].text).toContain("Removed");
  });

  it("checks watchlist and reports current prices", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([
        { symbol: "AAPL", addedAt: "2024-01-01", targetPrice: 200, stopPrice: 150 },
      ]),
    );

    const result = await watchlistTool.execute("test", { action: "check" });
    expect(result.content[0].text).toContain("AAPL");
    expect(result.content[0].text).toContain("180"); // mocked price
  });

  it("flags when target price is hit", async () => {
    vi.mocked(getQuote).mockResolvedValue({ price: 210 } as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([
        { symbol: "AAPL", addedAt: "2024-01-01", targetPrice: 200 },
      ]),
    );

    const result = await watchlistTool.execute("test", { action: "check" });
    expect(result.content[0].text.toLowerCase()).toMatch(/target|alert|hit/);
  });

  it("flags when stop price is hit", async () => {
    vi.mocked(getQuote).mockResolvedValue({ price: 140 } as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([
        { symbol: "AAPL", addedAt: "2024-01-01", stopPrice: 150 },
      ]),
    );

    const result = await watchlistTool.execute("test", { action: "check" });
    expect(result.content[0].text.toLowerCase()).toMatch(/stop|alert|below/);
  });

  it("reports empty watchlist", async () => {
    const result = await watchlistTool.execute("test", { action: "check" });
    expect(result.content[0].text.toLowerCase()).toContain("empty");
  });
});
