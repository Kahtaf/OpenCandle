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
    });
    service.recordReportRun({
      status: "completed",
      completedAt: "2026-07-05T14:30:00.000Z",
      summary: {
        symbols: ["ASTS"],
        headline: "Launch cadence improved",
        text: "Daily Watchlist Report\nASTS quote line\nData gaps: none\nConclusion: launch cadence improved.",
      },
      errors: [],
    });

    const portfolio = formatPortfolioSummary(service.listPortfolioLots());
    const watchlist = formatWatchlistSummary(service.listWatchlistItems());
    const report = formatLatestReportSummary(service.listReportRuns()[0]);

    expect(portfolio).toEqual([
      "Portfolio lots:",
      "- ASTS: 40 @ $28.00, cost basis $1120.00 (AST SpaceMobile, Inc.)",
    ]);
    expect(watchlist).toEqual(["Watchlist:", "- ASTS (AST SpaceMobile, Inc.)"]);
    expect(report[0]).toContain("Latest report run: completed at 2026-07-05T14:30:00.000Z");
    expect(report[0]).toContain('"headline":"Launch cadence improved"');
    expect(report).toContain("Report text:");
    expect(report).toContain(
      "Daily Watchlist Report\nASTS quote line\nData gaps: none\nConclusion: launch cadence improved.",
    );
    expect([...portfolio, ...watchlist, ...report].join("\n")).not.toContain(
      "Use this saved user state",
    );

    const compactReport = formatLatestReportSummary(service.listReportRuns()[0], {
      includeSummary: false,
    });
    expect(compactReport).toEqual(["Latest report run: completed at 2026-07-05T14:30:00.000Z"]);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
