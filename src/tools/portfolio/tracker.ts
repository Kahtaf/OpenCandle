import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getQuote } from "../../providers/yahoo-finance.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import type { Position, PortfolioSummary } from "../../types/portfolio.js";
import { initDefaultDatabase } from "../../memory/sqlite.js";
import { MarketStateService } from "../../market-state/service.js";
import { isZeroFilledQuote } from "../../market-state/resolve.js";
import { resolveInstrumentForMutation } from "../../market-state/resolve-for-mutation.js";

async function getCurrentPrice(symbol: string): Promise<
  | { status: "ok"; price: number; currency: string | null }
  | { status: "unavailable"; reason: string }
> {
  const result = await wrapProvider("yahoo", () => getQuote(symbol));
  if (result.status === "unavailable") return { status: "unavailable", reason: result.reason };
  if (result.stale) return { status: "unavailable", reason: "provider returned stale market data" };
  if (isZeroFilledQuote(result.data)) {
    return { status: "unavailable", reason: "Yahoo returned no valid market data." };
  }
  return { status: "ok", price: result.data.price, currency: result.data.currency ?? null };
}

const params = Type.Object({
  action: Type.Union([
    Type.Literal("add"),
    Type.Literal("update"),
    Type.Literal("remove"),
    Type.Literal("view"),
  ], { description: "Action: add a position, update a lot, remove a position, or view portfolio" }),
  lot_id: Type.Optional(
    Type.Number({ description: "Portfolio lot id for precise update or single-lot removal" }),
  ),
  symbol: Type.Optional(
    Type.String({ description: "Ticker symbol — stocks (AAPL, MSFT) or crypto with -USD suffix (BTC-USD, ETH-USD, SOL-USD). Use search_ticker to find the right ticker." }),
  ),
  shares: Type.Optional(
    Type.Number({ description: "Number of shares/units (required for add)" }),
  ),
  avg_cost: Type.Optional(
    Type.Number({ description: "Average cost per share/unit in the lot currency (required for add)" }),
  ),
  currency: Type.Optional(
    Type.String({ description: "Lot currency, such as USD or CAD (defaults to the resolved instrument currency)" }),
  ),
});

export const portfolioTrackerTool: AgentTool<typeof params> = {
  name: "track_portfolio",
  label: "Portfolio Tracker",
  description:
    "Track your portfolio of stocks and crypto. Add/remove positions with cost basis, or view current holdings with live P&L. For stocks use standard tickers (AAPL, MSFT). For crypto use the -USD suffix (BTC-USD, ETH-USD, SOL-USD). Use search_ticker first if you're unsure of the exact ticker.",
  parameters: params,
  async execute(_toolCallId, args) {
    const db = initDefaultDatabase();
    const service = new MarketStateService(db);

    try {
      if (args.action === "add") {
        if (!args.symbol || !args.shares || !args.avg_cost) {
          throw new Error("symbol, shares, and avg_cost are required for add action.");
        }
        const instrument = await resolveInstrumentForMutation(args.symbol);
        if (instrument.status === "needs_selection") {
          return {
            content: [{
              type: "text",
              text: `Could not verify ${instrument.query}. Choose one of the returned candidates before adding it to the portfolio.`,
            }],
            details: instrument,
          };
        }
        const resolvedCurrency = args.currency?.trim() || instrument.instrument.currency?.trim();
        if (!resolvedCurrency) {
          return {
            content: [{
              type: "text",
              text: `Could not determine currency for ${instrument.instrument.symbol}. Supply currency explicitly before adding it to the portfolio.`,
            }],
            details: {
              status: "needs_currency",
              symbol: instrument.instrument.symbol,
            },
          };
        }
        const currency = resolvedCurrency.toUpperCase();
        const lot = service.addPortfolioLot({
          instrument: instrument.instrument,
          quantity: args.shares,
          avgCost: args.avg_cost,
          currency,
        });
        return {
          content: [{ type: "text", text: `Added ${args.shares} shares of ${lot.symbol} at ${formatMoney(args.avg_cost, lot.currency)}` }],
          details: lot,
        };
      }

      if (args.action === "remove") {
        if (args.lot_id) {
          const removed = service.removePortfolioLot(args.lot_id);
          if (removed == null) {
            return {
              content: [{ type: "text", text: `lot ${args.lot_id} not found in portfolio` }],
              details: null,
            };
          }
          return {
            content: [{ type: "text", text: `Removed ${removed.symbol} portfolio lot ${removed.id}` }],
            details: removed,
          };
        }
        if (!args.symbol) {
          throw new Error("lot_id or symbol is required for remove action.");
        }
        const symbol = args.symbol.toUpperCase();
        const removedLots = service.listPortfolioLots().filter((lot) => lot.symbol === symbol);
        if (!service.removePortfolioLotsBySymbol(symbol)) {
          return {
            content: [{ type: "text", text: `${symbol} not found in portfolio` }],
            details: null,
          };
        }
        return {
          content: [{ type: "text", text: `Removed ${symbol} from portfolio` }],
          details: {
            symbol,
            removedCount: removedLots.length,
            removedLotIds: removedLots.map((lot) => lot.id),
            instrumentIds: [...new Set(removedLots.map((lot) => lot.instrumentId))],
          },
        };
      }

      if (args.action === "update") {
        if (!args.lot_id) {
          return {
            content: [{ type: "text", text: "lot_id is required for update action. Use view to find the lot id before updating a holding." }],
            details: {
              status: "needs_lot_id",
              symbol: args.symbol?.toUpperCase(),
            },
          };
        }
        const updateParams = {
          quantity: args.shares,
          avgCost: args.avg_cost,
          currency: args.currency?.trim() || undefined,
        };
        const updated = service.updatePortfolioLot(args.lot_id, updateParams);
        if (updated == null) {
          const target = args.lot_id ? `lot ${args.lot_id}` : args.symbol?.toUpperCase();
          return {
            content: [{ type: "text", text: `${target} not found in portfolio` }],
            details: null,
          };
        }
        return {
          content: [{ type: "text", text: `Updated ${updated.symbol} portfolio lot ${updated.id}` }],
          details: updated,
        };
      }

      const lots = service.listPortfolioLots();
      if (lots.length === 0) {
        return {
          content: [{ type: "text", text: "Portfolio is empty. Use add action to add positions." }],
          details: null,
        };
      }

      const portfolio = service.getDefaultPortfolio();
      const baseCurrency = portfolio.baseCurrency ?? "USD";
      const enriched = await Promise.all(
        lots.map(async (p) => {
          const quote = await getCurrentPrice(p.symbol);
          const totalCost = p.avgCost * p.quantity;
          const lotCurrency = p.currency || baseCurrency;
          const quoteCurrency = quote.status === "ok"
            ? quote.currency ?? p.instrumentCurrency ?? lotCurrency
            : p.instrumentCurrency ?? lotCurrency;
          const canValueRow = quote.status === "ok" && quoteCurrency === lotCurrency;
          const currentPrice = canValueRow ? quote.price : null;
          const marketValue = currentPrice == null ? null : currentPrice * p.quantity;
          const includedInTotals = canValueRow && lotCurrency === baseCurrency;
          const exclusionReason = quote.status === "unavailable"
            ? `Quote unavailable: ${quote.reason}`
            : includedInTotals
              ? undefined
              : canValueRow
                ? `No FX conversion from ${lotCurrency} to ${baseCurrency}`
                : `No FX conversion from ${quoteCurrency} to ${lotCurrency}`;
          const position: Position = {
            symbol: p.symbol,
            shares: p.quantity,
            avgCost: p.avgCost,
            currency: lotCurrency,
            addedAt: p.createdAt,
          };
          return {
            ...position,
            currentPrice,
            marketValue,
            totalCost,
            pnl: marketValue == null ? null : marketValue - totalCost,
            pnlPercent: marketValue == null ? null : ((marketValue - totalCost) / totalCost) * 100,
            includedInTotals,
            quoteStatus: quote.status,
            exclusionReason,
          };
        }),
      );

      const included = enriched.filter((p) => p.includedInTotals);
      const excludedFromTotals = enriched
        .filter((p) => !p.includedInTotals)
        .map((p) => ({
          symbol: p.symbol,
          currency: p.currency,
          reason: p.exclusionReason ?? `No FX conversion from ${p.currency} to ${baseCurrency}`,
        }));
      const totalValue = included.reduce((s, p) => s + (p.marketValue ?? 0), 0);
      const totalCost = included.reduce((s, p) => s + p.totalCost, 0);

      const summary: PortfolioSummary = {
        positions: enriched,
        baseCurrency,
        totalValue,
        totalCost,
        totalPnl: totalValue - totalCost,
        totalPnlPercent: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
        excludedFromTotals,
      };

      const header = `**Portfolio** — ${enriched.length} positions | Value: ${formatMoney(totalValue, baseCurrency)} | P&L: ${formatMoney(summary.totalPnl, baseCurrency)} (${summary.totalPnlPercent >= 0 ? "+" : ""}${summary.totalPnlPercent.toFixed(2)}%)`;
      const rows = enriched.map((p) => {
        const excluded = p.includedInTotals ? "" : ` [excluded from ${baseCurrency} totals: ${p.exclusionReason}]`;
        if (p.currentPrice == null || p.pnl == null || p.pnlPercent == null) {
          return `  ${p.symbol}: ${p.shares} @ ${formatMoney(p.avgCost, p.currency)} → unavailable | P&L: unavailable${excluded}`;
        }
        const sign = p.pnlPercent >= 0 ? "+" : "";
        return `  ${p.symbol}: ${p.shares} @ ${formatMoney(p.avgCost, p.currency)} → ${formatMoney(p.currentPrice, p.currency)} | P&L: ${formatMoney(p.pnl, p.currency)} (${sign}${p.pnlPercent.toFixed(2)}%)${excluded}`;
      });

      const exclusions = excludedFromTotals.length === 0
        ? []
        : [`Excluded from ${baseCurrency} totals: ${excludedFromTotals.map((p) => `${p.symbol} (${p.currency})`).join(", ")}`];
      const text = [header, ...rows, ...exclusions].join("\n");
      return { content: [{ type: "text", text }], details: summary };
    } finally {
      db.close();
    }
  },
};

function formatMoney(value: number, currency: string): string {
  if (currency === "USD") return `$${value.toFixed(2)}`;
  return `${currency} ${value.toFixed(2)}`;
}
