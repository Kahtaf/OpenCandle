import type Database from "better-sqlite3";
import { initDefaultDatabase } from "../../src/memory/sqlite.js";
import { MarketStateService } from "../../src/market-state/service.js";
import { searchYahooInstruments } from "../../src/market-state/resolve.js";

export interface MarketStateSnapshot {
  watchlist: ReturnType<MarketStateService["listWatchlistItems"]>;
  portfolio: ReturnType<MarketStateService["listPortfolioLots"]>;
  predictions: ReturnType<MarketStateService["listPredictions"]>;
  alerts: ReturnType<MarketStateService["listAlertRules"]>;
  alertEvents: ReturnType<MarketStateService["listAlertEvents"]>;
  reportTemplates: ReturnType<MarketStateService["listReportTemplates"]>;
  reportRuns: ReturnType<MarketStateService["listReportRuns"]>;
}

export function buildMarketStateSnapshot(db?: Database.Database): MarketStateSnapshot {
  const ownedDb = db ?? initDefaultDatabase();
  const service = new MarketStateService(ownedDb);
  try {
    return {
      watchlist: service.listWatchlistItems(),
      portfolio: service.listPortfolioLots(),
      predictions: service.listPredictions(),
      alerts: service.listAlertRules(),
      alertEvents: service.listAlertEvents(),
      reportTemplates: service.listReportTemplates(),
      reportRuns: service.listReportRuns(),
    };
  } finally {
    if (!db) ownedDb.close();
  }
}

export async function searchInstrumentCandidates(query: string): Promise<{
  query: string;
  candidates: Awaited<ReturnType<typeof searchYahooInstruments>>;
}> {
  const trimmed = query.trim();
  if (!trimmed) return { query: "", candidates: [] };
  return {
    query: trimmed,
    candidates: await searchYahooInstruments(trimmed),
  };
}
