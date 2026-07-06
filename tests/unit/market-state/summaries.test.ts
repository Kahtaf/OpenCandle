import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MarketStateService } from "../../../src/market-state/service.js";
import {
  formatLatestReportSummary,
  formatPortfolioSummary,
  formatWatchlistSummary,
} from "../../../src/market-state/summaries.js";
import { initDatabase } from "../../../src/memory/sqlite.js";

describe("market-state summaries", () => {
  it("formats saved objects as data-only lines for prompt attachments", () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-summaries-"));
    const db = initDatabase(join(dir, "state.db"));
    const service = new MarketStateService(db);
    const asts = {
      symbol: "ASTS",
      assetType: "equity",
      name: "AST SpaceMobile, Inc.",
      exchange: "NMS",
      currency: "USD",
      provider: "yahoo",
    };
    service.addPortfolioLot({
      instrument: asts,
      quantity: 40,
      avgCost: 28,
      currency: "USD",
    });
    service.addWatchlistItem({
      instrument: asts,
      targetPrice: 55,
      stopPrice: 22,
      thesis: "Space-based broadband satellite network",
      notes: "Watch launch cadence and carrier partnerships",
      tags: ["space", "satellite"],
    });
    service.recordReportRun({
      status: "completed",
      completedAt: "2026-07-05T14:30:00.000Z",
      summary: { symbols: ["ASTS"], headline: "Launch cadence improved" },
      errors: [],
    });

    const portfolio = formatPortfolioSummary(service.listPortfolioLots());
    const watchlist = formatWatchlistSummary(service.listWatchlistItems());
    const report = formatLatestReportSummary(service.listReportRuns()[0]);

    expect(portfolio).toEqual([
      "Portfolio lots:",
      "- ASTS: 40 @ $28.00, cost basis $1120.00 (AST SpaceMobile, Inc.)",
    ]);
    expect(watchlist).toEqual([
      "Watchlist:",
      "- ASTS (AST SpaceMobile, Inc.) — target $55.00; stop $22.00; thesis: Space-based broadband satellite network; tags: space, satellite; notes: Watch launch cadence and carrier partnerships",
    ]);
    expect(report).toEqual([
      'Latest report run: completed at 2026-07-05T14:30:00.000Z — {"symbols":["ASTS"],"headline":"Launch cadence improved"}',
    ]);
    expect([...portfolio, ...watchlist, ...report].join("\n")).not.toContain(
      "Use this saved user state",
    );
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
