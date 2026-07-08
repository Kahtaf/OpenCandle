import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeToolFromUi } from "../../../gui/server/invoke-tool.js";
import { buildMarketStateSnapshot } from "../../../gui/server/market-state-api.js";
import { initDefaultDatabase } from "../../../src/memory/sqlite.js";
import { getQuote } from "../../../src/providers/yahoo-finance.js";
import { portfolioTrackerTool } from "../../../src/tools/portfolio/tracker.js";
import { watchlistTool } from "../../../src/tools/portfolio/watchlist.js";
import type { StockQuote } from "../../../src/types/market.js";

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
}));

describe("market-state GUI/TUI parity", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;
  let messages: Message[];
  let sessionManager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-market-state-parity-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
    messages = [];
    sessionManager = {
      appendMessage(message: Message) {
        messages.push(message);
      },
    } as unknown as SessionManager;
    vi.mocked(getQuote).mockImplementation(async (symbol: string) =>
      quote(symbol.toUpperCase(), 180),
    );
  });

  afterEach(() => {
    if (originalEnv == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalEnv;
    }
    rmSync(openCandleHome, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("shares persisted rows between UI-originated tool calls, direct TUI tools, and GUI snapshots", async () => {
    await invokeToolFromUi(
      sessionManager,
      watchlistTool,
      { action: "add", symbol: "AAPL", watchlist_name: "MAG7" },
      "ui",
    );

    const tuiWatchlist = await watchlistTool.execute("test", {
      action: "check",
      watchlist_name: "MAG7",
    });
    expect(tuiWatchlist.content[0].text).toContain("AAPL");

    await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "VTI",
      shares: 2,
      avg_cost: 150,
    });

    const db = initDefaultDatabase();
    const snapshot = buildMarketStateSnapshot(db);
    db.close();

    expect(snapshot.watchlists.map((watchlist) => watchlist.name)).toEqual(["Default", "MAG7"]);
    expect(snapshot.watchlist.map((item) => item.symbol)).toEqual(["AAPL"]);
    expect(snapshot.portfolio.map((lot) => lot.symbol)).toEqual(["VTI"]);
    expect(
      messages.some(
        (message) =>
          message.role === "toolResult" &&
          message.toolName === "manage_watchlist" &&
          message.details?.stateChange?.source === "ui" &&
          typeof message.details.stateChange.targetId === "number" &&
          typeof message.details.stateChange.instrumentId === "number",
      ),
    ).toBe(true);
  });

  it("shares GUI-originated watchlist renames with later TUI reads", async () => {
    await watchlistTool.execute("test", {
      action: "create",
      watchlist_name: "Growth",
    });
    await watchlistTool.execute("test", {
      action: "add",
      symbol: "NVDA",
      watchlist_name: "Growth",
    });

    await invokeToolFromUi(
      sessionManager,
      watchlistTool,
      { action: "rename", watchlist_name: "Growth", new_watchlist_name: "AI" },
      "ui",
    );

    const tuiWatchlist = await watchlistTool.execute("test", {
      action: "check",
      watchlist_name: "AI",
    });
    const db = initDefaultDatabase();
    const snapshot = buildMarketStateSnapshot(db);
    db.close();

    expect(tuiWatchlist.content[0].text).toContain("NVDA");
    expect(snapshot.watchlists.map((watchlist) => watchlist.name)).toEqual(["Default", "AI"]);
    expect(
      messages.some(
        (message) =>
          message.role === "toolResult" &&
          message.toolName === "manage_watchlist" &&
          message.details?.stateChange?.source === "ui" &&
          message.details.stateChange.targetType === "watchlist",
      ),
    ).toBe(true);
  });

  it("makes GUI-originated portfolio lots visible to later TUI reads", async () => {
    await invokeToolFromUi(
      sessionManager,
      portfolioTrackerTool,
      {
        action: "add",
        symbol: "VTI",
        shares: 2,
        avg_cost: 150,
      },
      "ui",
    );

    const tuiPortfolio = await portfolioTrackerTool.execute("test", { action: "view" });

    expect(tuiPortfolio.content[0].text).toContain("VTI");
    expect(tuiPortfolio.details?.positions).toEqual([
      expect.objectContaining({
        symbol: "VTI",
        shares: 2,
        avgCost: 150,
      }),
    ]);
    expect(
      messages.some(
        (message) =>
          message.role === "toolResult" &&
          message.toolName === "track_portfolio" &&
          message.details?.stateChange?.source === "ui" &&
          message.details.stateChange.domain === "portfolio" &&
          typeof message.details.stateChange.targetId === "number" &&
          typeof message.details.stateChange.instrumentId === "number",
      ),
    ).toBe(true);
  });

  it("shares GUI-originated portfolio renames with later TUI reads", async () => {
    await portfolioTrackerTool.execute("test", {
      action: "add",
      portfolio_name: "Trading",
      symbol: "TSLA",
      shares: 1,
      avg_cost: 200,
    });

    await invokeToolFromUi(
      sessionManager,
      portfolioTrackerTool,
      { action: "rename", portfolio_name: "Trading", new_portfolio_name: "Speculative" },
      "ui",
    );

    const tuiPortfolio = await portfolioTrackerTool.execute("test", {
      action: "view",
      portfolio_name: "Speculative",
    });
    const db = initDefaultDatabase();
    const snapshot = buildMarketStateSnapshot(db);
    db.close();

    expect(tuiPortfolio.content[0].text).toContain("TSLA");
    expect(snapshot.portfolios.map((portfolio) => portfolio.name)).toEqual([
      "Default",
      "Speculative",
    ]);
    expect(
      messages.some(
        (message) =>
          message.role === "toolResult" &&
          message.toolName === "track_portfolio" &&
          message.details?.stateChange?.source === "ui" &&
          message.details.stateChange.domain === "portfolio" &&
          message.details.stateChange.targetType === "portfolio",
      ),
    ).toBe(true);
  });
});

function quote(symbol: string, price: number): StockQuote {
  return {
    symbol,
    price,
    change: 0,
    changePercent: 0,
    open: price,
    high: price,
    low: price,
    previousClose: price,
    volume: 1_000,
    marketCap: 0,
    pe: null,
    week52High: price + 10,
    week52Low: price - 10,
    timestamp: Date.now(),
    currency: "USD",
  };
}
