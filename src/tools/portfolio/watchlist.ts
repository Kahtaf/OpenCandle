import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { isZeroFilledQuote } from "../../market-state/resolve.js";
import { resolveInstrumentForMutation } from "../../market-state/resolve-for-mutation.js";
import { MarketStateService, type WatchlistItemRecord } from "../../market-state/service.js";
import { initDefaultDatabase } from "../../memory/sqlite.js";
import { getQuotes, type TradingViewQuote } from "../../providers/tradingview.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { getQuote } from "../../providers/yahoo-finance.js";

interface WatchlistCheck extends WatchlistItemRecord {
  currentPrice: number | null;
  alerts: string[];
  statuses: string[];
  sourceProvider?: "tradingview" | "yahoo";
  dataCaveat?: string;
}

const params = Type.Object({
  action: Type.Union(
    [Type.Literal("add"), Type.Literal("update"), Type.Literal("remove"), Type.Literal("check")],
    { description: "One of: 'add', 'update', 'remove', or 'check'" },
  ),
  symbol: Type.Optional(Type.String({ description: "Ticker symbol (required for add/remove)" })),
  target_price: Type.Optional(
    Type.Union([
      Type.Number({ description: "Alert when price rises above this level" }),
      Type.Null({ description: "Clear the existing target price during update" }),
    ]),
  ),
  stop_price: Type.Optional(
    Type.Union([
      Type.Number({ description: "Alert when price falls below this level" }),
      Type.Null({ description: "Clear the existing stop price during update" }),
    ]),
  ),
  notes: Type.Optional(
    Type.Union([
      Type.String({ description: "Optional notes for why you're watching this" }),
      Type.Null({ description: "Clear existing notes during update" }),
    ]),
  ),
  thesis: Type.Optional(
    Type.Union([
      Type.String({ description: "Optional thesis for why you're watching this" }),
      Type.Null({ description: "Clear the existing thesis during update" }),
    ]),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), { description: "Optional tags for organizing the watchlist item" }),
  ),
});

export const watchlistTool: AgentTool<typeof params> = {
  name: "manage_watchlist",
  label: "Watchlist",
  description:
    "Manage your watchlist of stocks and crypto. Add symbols with optional target and stop prices, remove symbols, or check current prices against your watchlist levels.",
  parameters: params,
  async execute(_toolCallId, args) {
    const db = initDefaultDatabase();
    const service = new MarketStateService(db);

    try {
      if (args.action === "add") {
        if (!args.symbol) {
          throw new Error("symbol is required for add action.");
        }
        const instrument = await resolveInstrumentForMutation(args.symbol);
        if (instrument.status === "needs_selection") {
          return {
            content: [
              {
                type: "text",
                text: `Could not verify ${instrument.query}. Choose one of the returned candidates before adding it to the watchlist.`,
              },
            ],
            details: instrument,
          };
        }
        const item = service.addWatchlistItem({
          instrument: instrument.instrument,
          targetPrice: args.target_price,
          stopPrice: args.stop_price,
          thesis: args.thesis,
          notes: args.notes,
          tags: args.tags,
        });
        const alerts = [];
        if (args.target_price) alerts.push(`target: $${args.target_price}`);
        if (args.stop_price) alerts.push(`stop: $${args.stop_price}`);
        const alertStr = alerts.length > 0 ? ` (${alerts.join(", ")})` : "";
        return {
          content: [{ type: "text", text: `Added ${item.symbol} to watchlist${alertStr}` }],
          details: item,
        };
      }

      if (args.action === "remove") {
        if (!args.symbol) {
          throw new Error("symbol is required for remove action.");
        }
        const symbol = args.symbol.toUpperCase();
        if (!service.removeWatchlistItemBySymbol(symbol)) {
          return {
            content: [{ type: "text", text: `${symbol} not found in watchlist` }],
            details: null,
          };
        }
        return {
          content: [{ type: "text", text: `Removed ${symbol} from watchlist` }],
          details: null,
        };
      }

      if (args.action === "update") {
        if (!args.symbol) {
          throw new Error("symbol is required for update action.");
        }
        const symbol = args.symbol.toUpperCase();
        const item = service.updateWatchlistItemBySymbol(symbol, {
          targetPrice: args.target_price,
          stopPrice: args.stop_price,
          notes: args.notes,
          thesis: args.thesis,
          tags: args.tags,
        });
        if (item == null) {
          return {
            content: [{ type: "text", text: `${symbol} not found in watchlist` }],
            details: null,
          };
        }
        return {
          content: [{ type: "text", text: `Updated ${item.symbol} in watchlist` }],
          details: item,
        };
      }

      const items = service.listWatchlistItems();
      if (items.length === 0) {
        return {
          content: [{ type: "text", text: "Watchlist is empty. Use add action to add symbols." }],
          details: null,
        };
      }

      const checks = await checkWatchlistPrices(items);
      const alertItems = checks.filter((c) => c.alerts.length > 0);
      const lines = [
        `**Watchlist** — ${items.length} symbols${alertItems.length > 0 ? ` | ${alertItems.length} ALERT(S)` : ""}`,
        "",
      ];

      const tradingViewCaveats = Array.from(
        new Set(
          checks
            .filter((c) => c.sourceProvider === "tradingview")
            .map(
              (c) =>
                c.dataCaveat ??
                "TradingView scanner data may be delayed about 15 minutes and comes from an unofficial endpoint.",
            ),
        ),
      );
      if (tradingViewCaveats.length > 0) {
        lines.push(...tradingViewCaveats.map((caveat) => `Data caveat: ${caveat}`), "");
      }

      for (const c of checks) {
        const alertStr = c.alerts.length > 0 ? ` ** ${c.alerts.join(" | ")} **` : "";
        const statusStr = c.statuses.length > 0 ? ` | ${c.statuses.join(" | ")}` : "";
        const targetStr = c.targetPrice ? ` | Target: $${c.targetPrice}` : "";
        const stopStr = c.stopPrice ? ` | Stop: $${c.stopPrice}` : "";
        const sourceStr = c.sourceProvider
          ? ` | Source: ${c.sourceProvider === "tradingview" ? "TradingView" : "Yahoo"}`
          : "";
        const priceStr =
          typeof c.currentPrice === "number" ? `$${c.currentPrice.toFixed(2)}` : "Unavailable";
        lines.push(
          `  ${c.symbol}: ${priceStr}${targetStr}${stopStr}${sourceStr}${statusStr}${alertStr}`,
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { items: checks },
      };
    } finally {
      db.close();
    }
  },
};

async function checkWatchlistPrices(items: WatchlistItemRecord[]): Promise<WatchlistCheck[]> {
  const tradingViewSymbols = items
    .map((item) => item.symbol)
    .filter((symbol) => !shouldSkipTradingView(symbol));
  const tradingViewQuotes = new Map<string, TradingViewQuote>();

  if (tradingViewSymbols.length > 0) {
    const result = await wrapProvider("tradingview", () => getQuotes(tradingViewSymbols));
    if (result.status === "ok" && result.data.length > 0) {
      for (const quote of result.data) {
        tradingViewQuotes.set(quote.requestedSymbol.toUpperCase(), {
          ...quote,
          dataCaveat: result.stale
            ? `cached TradingView data from ${result.timestamp}; ${quote.dataCaveat}`
            : quote.dataCaveat,
        });
      }
    }
  }

  return Promise.all(
    items.map(async (item) => {
      const tradingViewQuote = tradingViewQuotes.get(item.symbol.toUpperCase());
      if (tradingViewQuote) {
        return buildCheckResult(
          item,
          tradingViewQuote.price,
          "tradingview",
          tradingViewQuote.dataCaveat,
        );
      }

      const result = await wrapProvider("yahoo", () => getQuote(item.symbol));
      if (result.status === "unavailable") {
        return {
          ...item,
          currentPrice: null,
          alerts: [`UNAVAILABLE: ${result.reason}`],
          statuses: [],
        };
      }
      if (result.stale) {
        return {
          ...item,
          currentPrice: null,
          alerts: ["UNAVAILABLE: provider returned stale market data"],
          statuses: [],
        };
      }
      const quote = result.data;
      if (isZeroFilledQuote(quote)) {
        return {
          ...item,
          currentPrice: null,
          alerts: ["UNAVAILABLE: Yahoo returned no valid market data."],
          statuses: [],
        };
      }
      return buildCheckResult(item, quote.price, "yahoo");
    }),
  );
}

function buildCheckResult(
  item: WatchlistItemRecord,
  price: number,
  sourceProvider: "tradingview" | "yahoo",
  dataCaveat?: string,
): WatchlistCheck {
  const alerts: string[] = [];
  const statuses: string[] = [];
  if (item.targetPrice && price >= item.targetPrice) {
    alerts.push(`TARGET HIT: $${price.toFixed(2)} >= $${item.targetPrice}`);
  } else if (item.targetPrice) {
    statuses.push(`Target pending: $${price.toFixed(2)} < $${item.targetPrice}`);
  }
  if (item.stopPrice && price <= item.stopPrice) {
    alerts.push(`STOP ALERT: $${price.toFixed(2)} fell below $${item.stopPrice}`);
  } else if (item.stopPrice) {
    statuses.push(`Stop OK: $${price.toFixed(2)} > $${item.stopPrice}`);
  }
  return {
    ...item,
    currentPrice: price,
    alerts,
    statuses,
    sourceProvider,
    dataCaveat,
  };
}

function shouldSkipTradingView(symbol: string): boolean {
  return /(?:-USD|\.(?:TO|DE|T|L|HK))$/i.test(symbol.trim());
}
