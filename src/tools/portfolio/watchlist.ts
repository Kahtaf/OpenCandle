import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getQuote } from "../../providers/yahoo-finance.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { initDefaultDatabase } from "../../memory/sqlite.js";
import { MarketStateService } from "../../market-state/service.js";
import { isZeroFilledQuote } from "../../market-state/resolve.js";
import { resolveInstrumentForMutation } from "../../market-state/resolve-for-mutation.js";

const params = Type.Object({
  action: Type.Union(
    [Type.Literal("add"), Type.Literal("update"), Type.Literal("remove"), Type.Literal("check")],
    { description: "One of: 'add', 'update', 'remove', or 'check'" },
  ),
  symbol: Type.Optional(
    Type.String({ description: "Ticker symbol (required for add/remove)" }),
  ),
  target_price: Type.Optional(
    Type.Number({ description: "Alert when price rises above this level" }),
  ),
  stop_price: Type.Optional(
    Type.Number({ description: "Alert when price falls below this level" }),
  ),
  notes: Type.Optional(
    Type.String({ description: "Optional notes for why you're watching this" }),
  ),
  thesis: Type.Optional(
    Type.String({ description: "Optional thesis for why you're watching this" }),
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
            content: [{
              type: "text",
              text: `Could not verify ${instrument.query}. Choose one of the returned candidates before adding it to the watchlist.`,
            }],
            details: instrument,
          };
        }
        const item = service.addWatchlistItem({
          instrument: instrument.instrument,
          targetPrice: args.target_price,
          stopPrice: args.stop_price,
          notes: args.notes,
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

      const checks = await Promise.all(
        items.map(async (item) => {
          const result = await wrapProvider("yahoo", () => getQuote(item.symbol));
          if (result.status === "unavailable") {
            return { ...item, currentPrice: null, alerts: [`UNAVAILABLE: ${result.reason}`], statuses: [] };
          }
          const quote = result.data;
          if (isZeroFilledQuote(quote)) {
            return { ...item, currentPrice: null, alerts: ["UNAVAILABLE: Yahoo returned no valid market data."], statuses: [] };
          }
          const alerts: string[] = [];
          const statuses: string[] = [];
          if (item.targetPrice && quote.price >= item.targetPrice) {
            alerts.push(`TARGET HIT: $${quote.price.toFixed(2)} >= $${item.targetPrice}`);
          } else if (item.targetPrice) {
            statuses.push(`Target pending: $${quote.price.toFixed(2)} < $${item.targetPrice}`);
          }
          if (item.stopPrice && quote.price <= item.stopPrice) {
            alerts.push(`STOP ALERT: $${quote.price.toFixed(2)} fell below $${item.stopPrice}`);
          } else if (item.stopPrice) {
            statuses.push(`Stop OK: $${quote.price.toFixed(2)} > $${item.stopPrice}`);
          }
          return { ...item, currentPrice: quote.price, alerts, statuses };
        }),
      );

      const alertItems = checks.filter((c) => c.alerts.length > 0);
      const lines = [
        `**Watchlist** — ${items.length} symbols${alertItems.length > 0 ? ` | ${alertItems.length} ALERT(S)` : ""}`,
        "",
      ];

      for (const c of checks) {
        const alertStr = c.alerts.length > 0 ? ` ** ${c.alerts.join(" | ")} **` : "";
        const statusStr = c.statuses.length > 0 ? ` | ${c.statuses.join(" | ")}` : "";
        const targetStr = c.targetPrice ? ` | Target: $${c.targetPrice}` : "";
        const stopStr = c.stopPrice ? ` | Stop: $${c.stopPrice}` : "";
        const priceStr = typeof c.currentPrice === "number" ? `$${c.currentPrice.toFixed(2)}` : "Unavailable";
        lines.push(`  ${c.symbol}: ${priceStr}${targetStr}${stopStr}${statusStr}${alertStr}`);
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
