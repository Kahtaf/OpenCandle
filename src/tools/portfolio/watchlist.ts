import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getQuote } from "../../providers/yahoo-finance.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { ensureParentDir, getWatchlistPath } from "../../infra/opencandle-paths.js";

interface WatchlistItem {
  symbol: string;
  addedAt: string;
  targetPrice?: number;
  stopPrice?: number;
  notes?: string;
}

function loadWatchlist(): WatchlistItem[] {
  const watchlistPath = getWatchlistPath();
  if (!existsSync(watchlistPath)) return [];
  try {
    return JSON.parse(readFileSync(watchlistPath, "utf-8"));
  } catch {
    return [];
  }
}

function saveWatchlist(items: WatchlistItem[]): void {
  const watchlistPath = getWatchlistPath();
  ensureParentDir(watchlistPath);
  writeFileSync(watchlistPath, JSON.stringify(items, null, 2));
}

const params = Type.Object({
  action: Type.Union(
    [Type.Literal("add"), Type.Literal("remove"), Type.Literal("check")],
    { description: "One of: 'add', 'remove', or 'check'" },
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
});

export const watchlistTool: AgentTool<typeof params> = {
  name: "manage_watchlist",
  label: "Watchlist",
  description:
    "Manage your watchlist of stocks and crypto. Add symbols with optional target and stop prices, remove symbols, or check current prices against your alert levels. Data persisted to ~/.opencandle/watchlist.json.",
  parameters: params,
  async execute(toolCallId, args) {
    const items = loadWatchlist();

    if (args.action === "add") {
      if (!args.symbol) {
        throw new Error("symbol is required for add action.");
      }
      const symbol = args.symbol.toUpperCase();
      const existing = items.findIndex((i) => i.symbol === symbol);
      const item: WatchlistItem = {
        symbol,
        addedAt: new Date().toISOString(),
        ...(args.target_price != null && { targetPrice: args.target_price }),
        ...(args.stop_price != null && { stopPrice: args.stop_price }),
        ...(args.notes != null && { notes: args.notes }),
      };
      if (existing >= 0) {
        items[existing] = item;
      } else {
        items.push(item);
      }
      saveWatchlist(items);
      const alerts = [];
      if (args.target_price) alerts.push(`target: $${args.target_price}`);
      if (args.stop_price) alerts.push(`stop: $${args.stop_price}`);
      const alertStr = alerts.length > 0 ? ` (${alerts.join(", ")})` : "";
      return {
        content: [{ type: "text", text: `Added ${symbol} to watchlist${alertStr}` }],
        details: null,
      };
    }

    if (args.action === "remove") {
      if (!args.symbol) {
        throw new Error("symbol is required for remove action.");
      }
      const symbol = args.symbol.toUpperCase();
      const idx = items.findIndex((i) => i.symbol === symbol);
      if (idx === -1) {
        return {
          content: [{ type: "text", text: `${symbol} not found in watchlist` }],
          details: null,
        };
      }
      items.splice(idx, 1);
      saveWatchlist(items);
      return {
        content: [{ type: "text", text: `Removed ${symbol} from watchlist` }],
        details: null,
      };
    }

    // Check action
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
          return { ...item, currentPrice: 0, alerts: [`UNAVAILABLE: ${result.reason}`] };
        }
        const quote = result.data;
        const alerts: string[] = [];
        if (item.targetPrice && quote.price >= item.targetPrice) {
          alerts.push(`TARGET HIT: $${quote.price.toFixed(2)} >= $${item.targetPrice}`);
        }
        if (item.stopPrice && quote.price <= item.stopPrice) {
          alerts.push(`STOP ALERT: $${quote.price.toFixed(2)} fell below $${item.stopPrice}`);
        }
        return { ...item, currentPrice: quote.price, alerts };
      }),
    );

    const alertItems = checks.filter((c) => c.alerts.length > 0);
    const lines = [
      `**Watchlist** — ${items.length} symbols${alertItems.length > 0 ? ` | ${alertItems.length} ALERT(S)` : ""}`,
      "",
    ];

    for (const c of checks) {
      const alertStr = c.alerts.length > 0 ? ` ** ${c.alerts.join(" | ")} **` : "";
      const targetStr = c.targetPrice ? ` | Target: $${c.targetPrice}` : "";
      const stopStr = c.stopPrice ? ` | Stop: $${c.stopPrice}` : "";
      lines.push(`  ${c.symbol}: $${c.currentPrice.toFixed(2)}${targetStr}${stopStr}${alertStr}`);
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: { items: checks },
    };
  },
};
