import {
  acquirePortfolioValuation,
  type SecurityObservation,
} from "../../portfolio/acquisition.js";
import type { FxResult } from "../../portfolio/fx.js";
import type { valuePortfolio } from "../../portfolio/valuation.js";
import { createFxResolver } from "../../providers/yahoo-fx.js";

export type PortfolioPriceResult = SecurityObservation;
export type PortfolioPriceResolver = (symbol: string) => Promise<PortfolioPriceResult>;
export interface PortfolioValuationDependencies {
  now?: () => number;
  resolveFx?: (source: string, target: string) => Promise<FxResult> | FxResult;
}
type Lot = {
  id: number;
  symbol: string;
  quantity: number;
  avgCost: number;
  currency: string;
  createdAt?: string;
};
export function presentPortfolioValuation(
  lots: readonly Lot[],
  baseCurrency: string,
  valuation: ReturnType<typeof valuePortfolio>,
) {
  const positions = lots.map((lot, index) => {
    const row = valuation.rows[index];
    const cost = row.reportingCost?.amount ?? null;
    const pnl = row.reportingPnl?.amount ?? null;
    return {
      ...row,
      symbol: lot.symbol,
      shares: lot.quantity,
      avgCost: lot.avgCost,
      currency: lot.currency,
      addedAt: lot.createdAt ?? "",
      lotId: lot.id,
      currentPrice:
        row.nativeValue && lot.quantity > 0 ? row.nativeValue.amount / lot.quantity : null,
      quoteCurrency: row.nativeValue?.currency ?? null,
      reportingCurrency: baseCurrency,
      marketValue: row.reportingValue?.amount ?? null,
      totalCost: cost,
      pnl,
      pnlPercent: pnl !== null && cost !== null && cost > 0 ? (pnl / cost) * 100 : null,
      includedInTotals: row.reportingValue !== null,
      quoteStatus: row.nativeValue ? ("ok" as const) : ("unavailable" as const),
      exclusionReason: row.reason ?? undefined,
    };
  });
  const totalCost = valuation.totalCost?.amount ?? null;
  const totalPnl = valuation.totalPnl?.amount ?? null;
  return {
    positions,
    baseCurrency,
    totalsStatus: valuation.status,
    totalValue: valuation.totalValue?.amount ?? null,
    valuedSubtotal: valuation.valuedSubtotal?.amount ?? null,
    totalCost,
    totalPnl,
    totalPnlPercent:
      totalPnl !== null && totalCost !== null
        ? totalCost > 0
          ? (totalPnl / totalCost) * 100
          : 0
        : null,
    costSubtotals: valuation.costSubtotals,
    includedLotIds: valuation.includedLotIds,
    excludedLotIds: valuation.excludedLotIds,
    excludedFromTotals: positions
      .filter((p) => !p.includedInTotals)
      .map((p) => ({
        lotId: p.lotId,
        symbol: p.symbol,
        currency: p.currency,
        reason: p.exclusionReason ?? "unavailable",
      })),
  };
}
export type ResolvedPortfolioSummary = ReturnType<typeof presentPortfolioValuation>;
export type PortfolioPositionSummary = ResolvedPortfolioSummary["positions"][number];
export async function buildPortfolioView(
  lots: readonly Lot[],
  baseCurrency: string,
  getCurrentPrice: PortfolioPriceResolver,
  dependencies: PortfolioValuationDependencies = {},
): Promise<ResolvedPortfolioSummary> {
  const now = (dependencies.now ?? Date.now)();
  const { valuation } = await acquirePortfolioValuation({
    lots: lots.map((l) => ({ ...l, id: String(l.id), costCurrency: l.currency })),
    reportingCurrency: baseCurrency,
    now,
    resolveSecurity: getCurrentPrice,
    resolveFx: dependencies.resolveFx ?? createFxResolver(now),
  });
  return presentPortfolioValuation(lots, baseCurrency, valuation);
}
export function renderPortfolioView(name: string, summary: ResolvedPortfolioSummary): string {
  const money = (value: number | null, currency = summary.baseCurrency) =>
    value === null ? "unavailable" : formatMoney(value, currency);
  const header = `**${name}** — ${summary.positions.length} positions | Value: ${money(summary.totalValue)} | P&L: ${money(summary.totalPnl)}`;
  const subtotal =
    summary.totalsStatus === "partial"
      ? [
          `Valued subtotal: ${money(summary.valuedSubtotal)} (partial; excludes unavailable holdings)`,
        ]
      : [];
  return [
    header,
    ...subtotal,
    ...summary.positions.map(
      (p) =>
        `  ${p.symbol} [lot ${p.lotId}]: ${p.shares} @ ${money(p.avgCost, p.currency)} → ${money(p.currentPrice, p.quoteCurrency ?? p.currency)} | Value: ${money(p.marketValue)} | P&L: ${money(p.pnl)}${p.exclusionReason ? ` [excluded: ${p.exclusionReason}]` : ""} | Native value: ${money(p.nativeValue?.amount ?? null, p.nativeValue?.currency)} | Native price P&L: ${money(p.nativePnl?.amount ?? null, p.nativePnl?.currency)} | Security: ${p.securityObservedAt === null ? "timestamp unavailable" : new Date(p.securityObservedAt).toISOString()}${p.fx?.status === "ok" && p.fx.method !== "identity" ? ` | FX ${p.fx.source}→${p.fx.target}: ${p.fx.rate} (${p.fx.lastSession ? "last session" : "observed"} ${p.fx.observedAt === null ? "unknown" : new Date(p.fx.observedAt).toISOString()}; ${p.fx.legs.map((leg) => `${leg.provider} ${leg.requestedSymbol}`).join(", ")})` : ""}`,
    ),
  ].join("\n");
}
export function formatMoney(value: number, currency: string): string {
  return currency === "USD" ? `$${value.toFixed(2)}` : `${currency} ${value.toFixed(2)}`;
}
