import type { PortfolioLotRecord } from "../../market-state/service.js";
import type { PortfolioSummary, Position } from "../../types/portfolio.js";

export type PortfolioPriceResult =
  | { status: "ok"; price: number; currency: string | null }
  | { status: "unavailable"; reason: string };

export type PortfolioPriceResolver = (symbol: string) => Promise<PortfolioPriceResult>;

export type PortfolioPositionSummary = Position & {
  lotId: number;
  currentPrice: number | null;
  marketValue: number | null;
  totalCost: number;
  pnl: number | null;
  pnlPercent: number | null;
  includedInTotals: boolean;
  quoteStatus: "ok" | "unavailable";
  exclusionReason?: string;
};

export type ResolvedPortfolioSummary = Omit<
  PortfolioSummary,
  "positions" | "totalValue" | "totalCost" | "totalPnl" | "totalPnlPercent"
> & {
  positions: PortfolioPositionSummary[];
  totalValue: number | null;
  totalCost: number;
  totalPnl: number | null;
  totalPnlPercent: number | null;
  totalsStatus: "empty" | "ok" | "unavailable";
};

export async function buildPortfolioView(
  lots: PortfolioLotRecord[],
  baseCurrency: string,
  getCurrentPrice: PortfolioPriceResolver,
): Promise<ResolvedPortfolioSummary> {
  const positions = await Promise.all(
    lots.map(async (lot) => {
      const quote = await getCurrentPrice(lot.symbol);
      const totalCost = lot.avgCost * lot.quantity;
      const lotCurrency = lot.currency || baseCurrency;
      const quoteCurrency =
        quote.status === "ok"
          ? (quote.currency ?? lot.instrumentCurrency ?? null)
          : (lot.instrumentCurrency ?? null);
      const canValueRow =
        quote.status === "ok" && quoteCurrency != null && quoteCurrency === lotCurrency;
      const currentPrice = canValueRow ? quote.price : null;
      const marketValue = currentPrice == null ? null : currentPrice * lot.quantity;
      const includedInTotals = canValueRow && lotCurrency === baseCurrency;
      const exclusionReason =
        quote.status === "unavailable"
          ? `Quote unavailable: ${quote.reason}`
          : includedInTotals
            ? undefined
            : quoteCurrency == null
              ? "Quote currency unavailable"
              : canValueRow
                ? `No FX conversion from ${lotCurrency} to ${baseCurrency}`
                : `No FX conversion from ${quoteCurrency} to ${lotCurrency}`;
      return {
        symbol: lot.symbol,
        shares: lot.quantity,
        avgCost: lot.avgCost,
        currency: lotCurrency,
        addedAt: lot.createdAt,
        lotId: lot.id,
        currentPrice,
        marketValue,
        totalCost,
        pnl: marketValue == null ? null : marketValue - totalCost,
        pnlPercent:
          marketValue == null || totalCost <= 0
            ? null
            : ((marketValue - totalCost) / totalCost) * 100,
        includedInTotals,
        quoteStatus: quote.status,
        ...(exclusionReason ? { exclusionReason } : {}),
      } satisfies PortfolioPositionSummary;
    }),
  );

  const included = positions.filter((position) => position.includedInTotals);
  const excludedFromTotals = positions
    .filter((position) => !position.includedInTotals)
    .map((position) => ({
      symbol: position.symbol,
      currency: position.currency,
      reason:
        position.exclusionReason ?? `No FX conversion from ${position.currency} to ${baseCurrency}`,
    }));
  const hasUnavailableBaseCurrencyPosition = positions.some(
    (position) => position.currency === baseCurrency && !position.includedInTotals,
  );
  const totalsStatus =
    lots.length === 0
      ? "empty"
      : hasUnavailableBaseCurrencyPosition || included.length === 0
        ? "unavailable"
        : "ok";
  const totalValue =
    totalsStatus === "unavailable"
      ? null
      : included.reduce((sum, position) => sum + (position.marketValue ?? 0), 0);
  const totalCost = positions
    .filter((position) => position.currency === baseCurrency)
    .reduce((sum, position) => sum + position.totalCost, 0);
  return {
    positions,
    baseCurrency,
    totalValue,
    totalCost,
    totalPnl: totalValue == null ? null : totalValue - totalCost,
    totalPnlPercent:
      totalValue == null ? null : totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
    totalsStatus,
    excludedFromTotals,
  };
}

export function renderPortfolioView(
  displayPortfolioName: string,
  summary: ResolvedPortfolioSummary,
): string {
  const header =
    summary.totalsStatus === "unavailable"
      ? `**${displayPortfolioName}** — ${summary.positions.length} positions | Value: unavailable | P&L: unavailable`
      : `**${displayPortfolioName}** — ${summary.positions.length} positions | Value: ${formatMoney(summary.totalValue ?? 0, summary.baseCurrency)} | P&L: ${formatMoney(summary.totalPnl ?? 0, summary.baseCurrency)} (${(summary.totalPnlPercent ?? 0) >= 0 ? "+" : ""}${(summary.totalPnlPercent ?? 0).toFixed(2)}%)`;
  const rows = summary.positions.map((position) => {
    const excluded = position.includedInTotals
      ? ""
      : ` [excluded from ${summary.baseCurrency} totals: ${position.exclusionReason}]`;
    if (position.currentPrice == null || position.pnl == null || position.pnlPercent == null) {
      return `  ${position.symbol} [lot ${position.lotId}]: ${position.shares} @ ${formatMoney(position.avgCost, position.currency)} → unavailable | P&L: unavailable${excluded}`;
    }
    const sign = position.pnlPercent >= 0 ? "+" : "";
    return `  ${position.symbol} [lot ${position.lotId}]: ${position.shares} @ ${formatMoney(position.avgCost, position.currency)} → ${formatMoney(position.currentPrice, position.currency)} | P&L: ${formatMoney(position.pnl, position.currency)} (${sign}${position.pnlPercent.toFixed(2)}%)${excluded}`;
  });
  const exclusions =
    summary.excludedFromTotals.length === 0
      ? []
      : [
          `Excluded from ${summary.baseCurrency} totals: ${summary.excludedFromTotals.map((position) => `${position.symbol} (${position.currency})`).join(", ")}`,
        ];
  return [header, ...rows, ...exclusions].join("\n");
}

export function formatMoney(value: number, currency: string): string {
  if (currency === "USD") return `$${value.toFixed(2)}`;
  return `${currency} ${value.toFixed(2)}`;
}
