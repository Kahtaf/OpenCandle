import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { isZeroFilledQuote } from "../../market-state/resolve.js";
import {
  type CollectionRecord,
  MarketStateService,
  type WatchlistItemRecord,
} from "../../market-state/service.js";
import { initDefaultDatabase } from "../../memory/sqlite.js";
import { getQuotes, type TradingViewQuote } from "../../providers/tradingview.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { getQuote } from "../../providers/yahoo-finance.js";
import { resolveStatefulInstrument, type StatefulToolOptions } from "./stateful-tool-options.js";

interface WatchlistCheck extends WatchlistItemRecord {
  currentPrice: number | null;
  statuses: string[];
  sourceProvider?: "tradingview" | "yahoo";
  dataCaveat?: string;
}

const params = Type.Object({
  action: Type.Union(
    [
      Type.Literal("create"),
      Type.Literal("rename"),
      Type.Literal("delete"),
      Type.Literal("add"),
      Type.Literal("remove"),
      Type.Literal("check"),
    ],
    { description: "One of: 'create', 'rename', 'delete', 'add', 'remove', or 'check'" },
  ),
  watchlist_name: Type.Optional(
    Type.String({
      description: "Named watchlist to create or use. Omit to use the default watchlist.",
    }),
  ),
  symbol: Type.Optional(Type.String({ description: "Ticker symbol (required for add)" })),
  item_id: Type.Optional(
    Type.Integer({ minimum: 1, description: "Stable watchlist row id for an exact remove." }),
  ),
  new_watchlist_name: Type.Optional(
    Type.String({ description: "New watchlist name (required for rename)." }),
  ),
});

export function createWatchlistTool(options: StatefulToolOptions): AgentTool<typeof params> {
  return {
    name: "manage_watchlist",
    label: "Watchlist",
    description:
      "Manage named watchlists of stocks and crypto. Create, rename, or delete watchlists, add symbols, remove symbols, or check current prices.",
    parameters: params,
    async execute(_toolCallId, args) {
      const db = options.stateDatabaseFactory();
      const service = new MarketStateService(db);

      try {
        if (args.action === "create") {
          if (!args.watchlist_name) {
            throw new Error("watchlist_name is required for create action.");
          }
          const watchlist = service.createWatchlist(args.watchlist_name);
          return {
            content: [{ type: "text", text: `Created watchlist ${watchlist.name}` }],
            details: watchlist,
          };
        }

        if (args.action === "rename") {
          if (!args.new_watchlist_name) {
            throw new Error("new_watchlist_name is required for rename action.");
          }
          const currentName = args.watchlist_name?.trim() || service.getDefaultWatchlist().name;
          const current = args.watchlist_name
            ? service.getWatchlistByName(currentName)
            : service.getDefaultWatchlist();
          if (current == null) {
            throw new Error(`watchlist ${currentName} not found.`);
          }
          const watchlist = service.renameWatchlist(current.name, args.new_watchlist_name);
          return {
            content: [{ type: "text", text: `Renamed ${current.name} to ${watchlist.name}` }],
            details: watchlist,
          };
        }

        if (args.action === "delete") {
          service.listWatchlists();
          const currentName = args.watchlist_name?.trim() || service.getDefaultWatchlist().name;
          const current = args.watchlist_name
            ? service.getWatchlistByName(currentName)
            : service.getDefaultWatchlist();
          if (current == null) {
            throw new Error(`watchlist ${currentName} not found.`);
          }
          const watchlist = service.deleteWatchlist(current.name);
          return {
            content: [
              {
                type: "text",
                text: `Deleted ${current.name}. ${watchlist.name} is now active.`,
              },
            ],
            details: watchlist,
          };
        }

        const defaultWatchlist = service.getDefaultWatchlist();
        const watchlist = !args.watchlist_name
          ? defaultWatchlist
          : args.action === "add"
            ? service.getOrCreateWatchlist(args.watchlist_name)
            : service.getWatchlistByName(args.watchlist_name);
        if (watchlist == null) {
          throw new Error(`watchlist ${args.watchlist_name?.trim()} not found.`);
        }

        if (args.action === "add") {
          if (!args.symbol) {
            throw new Error("symbol is required for add action.");
          }
          const instrument = await resolveStatefulInstrument(options, args.symbol, {
            unverifiedExactSymbol:
              (args as typeof args & { unverified_exact_symbol?: unknown })
                .unverified_exact_symbol === true,
          });
          if (instrument.status === "needs_selection") {
            return {
              content: [
                {
                  type: "text",
                  text: `Could not verify ${instrument.query}. Choose one of the returned candidates before adding it to ${watchlist.name}.`,
                },
              ],
              details: instrument,
            };
          }
          const item = service.addWatchlistItem({
            instrument: instrument.instrument,
            watchlistId: watchlist.id,
          });
          return {
            content: [{ type: "text", text: `Added ${item.symbol} to ${watchlist.name}` }],
            details: item,
          };
        }

        if (args.action === "remove") {
          if (args.item_id != null) {
            const item = service
              .listWatchlistItems(watchlist.id)
              .find(({ id }) => id === args.item_id);
            if (!item || !service.removeWatchlistItem(args.item_id, watchlist.id)) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Watchlist item ${args.item_id} not found in ${watchlist.name}`,
                  },
                ],
                details: null,
              };
            }
            return {
              content: [{ type: "text", text: `Removed ${item.symbol} from ${watchlist.name}` }],
              details: null,
            };
          }
          throw new Error(
            "item_id is required for remove action. Use check to find the stable watchlist item id.",
          );
        }

        const items = service.listWatchlistItems(watchlist.id);
        if (items.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `${watchlist.name} is empty. Use add action to add symbols.`,
              },
            ],
            details: { watchlist, items: [] },
          };
        }

        const checks = await checkWatchlistPrices(items);
        return {
          content: [{ type: "text", text: formatWatchlistCheck(watchlist, checks) }],
          details: { watchlist, items: checks },
        };
      } finally {
        if (options.closeDatabaseAfterExecute !== false) db.close();
      }
    },
  };
}

export const watchlistTool = createWatchlistTool({ stateDatabaseFactory: initDefaultDatabase });

function formatWatchlistCheck(watchlist: CollectionRecord, checks: WatchlistCheck[]): string {
  const lines = [`**${watchlist.name}** — ${checks.length} symbols`, ""];
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
    const statusStr = c.statuses.length > 0 ? ` | ${c.statuses.join(" | ")}` : "";
    const sourceStr = c.sourceProvider
      ? ` | Source: ${c.sourceProvider === "tradingview" ? "TradingView" : "Yahoo"}`
      : "";
    const priceStr =
      typeof c.currentPrice === "number" ? `$${c.currentPrice.toFixed(2)}` : "Unavailable";
    lines.push(`  ${c.symbol} [item ${c.id}]: ${priceStr}${sourceStr}${statusStr}`);
  }
  return lines.join("\n");
}

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
          statuses: [`UNAVAILABLE: ${result.reason}`],
        };
      }
      if (result.stale) {
        return {
          ...item,
          currentPrice: null,
          statuses: ["UNAVAILABLE: provider returned stale market data"],
        };
      }
      const quote = result.data;
      if (isZeroFilledQuote(quote)) {
        return {
          ...item,
          currentPrice: null,
          statuses: ["UNAVAILABLE: Yahoo returned no valid market data."],
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
  return {
    ...item,
    currentPrice: price,
    statuses: [],
    sourceProvider,
    dataCaveat,
  };
}

function shouldSkipTradingView(symbol: string): boolean {
  return /(?:-USD|\.(?:TO|DE|T|L|HK))$/i.test(symbol.trim());
}
