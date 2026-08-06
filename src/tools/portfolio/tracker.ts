import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { isZeroFilledQuote } from "../../market-state/resolve.js";
import { MarketStateService } from "../../market-state/service.js";
import { initDefaultDatabase } from "../../memory/sqlite.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { getQuote } from "../../providers/yahoo-finance.js";
import { buildPortfolioView, formatMoney, renderPortfolioView } from "./portfolio-view.js";
import { resolveStatefulInstrument, type StatefulToolOptions } from "./stateful-tool-options.js";

export async function getCurrentPrice(
  symbol: string,
): Promise<
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
  action: Type.Union(
    [
      Type.Literal("create"),
      Type.Literal("rename"),
      Type.Literal("add"),
      Type.Literal("update"),
      Type.Literal("remove"),
      Type.Literal("view"),
    ],
    {
      description:
        "Action: create or rename a portfolio, add a position, update a lot, remove a position, or view portfolio",
    },
  ),
  portfolio_name: Type.Optional(
    Type.String({
      description: "Portfolio name. Defaults to the Default portfolio when omitted.",
    }),
  ),
  new_portfolio_name: Type.Optional(
    Type.String({ description: "New portfolio name (required for rename)." }),
  ),
  lot_id: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "Portfolio lot id for precise update or single-lot removal",
    }),
  ),
  symbol: Type.Optional(
    Type.String({
      description:
        "Ticker symbol — stocks (AAPL, MSFT) or crypto with -USD suffix (BTC-USD, ETH-USD, SOL-USD). Use search_ticker to find the right ticker.",
    }),
  ),
  shares: Type.Optional(
    Type.Number({ exclusiveMinimum: 0, description: "Number of shares/units (required for add)" }),
  ),
  avg_cost: Type.Optional(
    Type.Number({
      exclusiveMinimum: 0,
      description: "Average cost per share/unit in the lot currency (required for add)",
    }),
  ),
  currency: Type.Optional(
    Type.String({
      description:
        "Lot currency, such as USD or CAD (defaults to the resolved instrument currency)",
    }),
  ),
});

export function createPortfolioTrackerTool(options: StatefulToolOptions): AgentTool<typeof params> {
  return {
    name: "track_portfolio",
    label: "Portfolio Tracker",
    description:
      "Track named portfolios of stocks and crypto. Create or rename portfolios, add/remove positions with cost basis, or view current holdings with live P&L. For stocks use standard tickers (AAPL, MSFT). For crypto use the -USD suffix (BTC-USD, ETH-USD, SOL-USD). Use search_ticker first if you're unsure of the exact ticker.",
    parameters: params,
    async execute(_toolCallId, args) {
      const db = options.stateDatabaseFactory();
      const service = new MarketStateService(db);

      try {
        if (args.action === "create") {
          if (!args.portfolio_name)
            throw new Error("portfolio_name is required for create action.");
          const portfolio = service.createPortfolio(args.portfolio_name);
          return {
            content: [{ type: "text", text: `Created portfolio ${portfolio.name}` }],
            details: portfolio,
          };
        }

        if (args.action === "rename") {
          if (!args.new_portfolio_name) {
            throw new Error("new_portfolio_name is required for rename action.");
          }
          const currentName = args.portfolio_name?.trim() || service.getDefaultPortfolio().name;
          const current = args.portfolio_name
            ? service.getPortfolioByName(currentName)
            : service.getDefaultPortfolio();
          if (current == null) {
            throw new Error(`portfolio ${currentName} not found.`);
          }
          const portfolio = service.renamePortfolio(current.name, args.new_portfolio_name);
          return {
            content: [{ type: "text", text: `Renamed ${current.name} to ${portfolio.name}` }],
            details: portfolio,
          };
        }

        const defaultPortfolio = service.getDefaultPortfolio();
        const portfolio = !args.portfolio_name
          ? defaultPortfolio
          : args.action === "add"
            ? service.getOrCreatePortfolio(args.portfolio_name)
            : service.getPortfolioByName(args.portfolio_name);
        if (portfolio == null) {
          throw new Error(`portfolio ${args.portfolio_name?.trim()} not found.`);
        }

        if (args.action === "add") {
          if (!args.symbol || args.shares == null || args.avg_cost == null) {
            throw new Error("symbol, shares, and avg_cost are required for add action.");
          }
          if (args.shares <= 0) throw new Error("shares must be greater than 0.");
          if (args.avg_cost <= 0) throw new Error("avg_cost must be greater than 0.");
          const instrument = await resolveStatefulInstrument(options, args.symbol, {
            currency: args.currency,
            unverifiedExactSymbol:
              (args as typeof args & { unverified_exact_symbol?: unknown })
                .unverified_exact_symbol === true,
          });
          if (instrument.status === "needs_selection") {
            return {
              content: [
                {
                  type: "text",
                  text: `Could not verify ${instrument.query}. Choose one of the returned candidates before adding it to the portfolio.`,
                },
              ],
              details: instrument,
            };
          }
          const resolvedCurrency = args.currency?.trim() || instrument.instrument.currency?.trim();
          if (!resolvedCurrency) {
            return {
              content: [
                {
                  type: "text",
                  text: `Could not determine currency for ${instrument.instrument.symbol}. Supply currency explicitly before adding it to the portfolio.`,
                },
              ],
              details: {
                status: "needs_currency",
                symbol: instrument.instrument.symbol,
              },
            };
          }
          const currency = resolvedCurrency.toUpperCase();
          const lot = service.addPortfolioLot({
            instrument: instrument.instrument,
            portfolioId: portfolio.id,
            quantity: args.shares,
            avgCost: args.avg_cost,
            currency,
          });
          return {
            content: [
              {
                type: "text",
                text: `Added ${args.shares} shares of ${lot.symbol} at ${formatMoney(args.avg_cost, lot.currency)}`,
              },
            ],
            details: lot,
          };
        }

        if (args.action === "remove") {
          if (args.lot_id != null) {
            const selectedLot = service
              .listPortfolioLots(portfolio.id)
              .find((lot) => lot.id === args.lot_id);
            if (selectedLot == null) {
              return {
                content: [{ type: "text", text: `lot ${args.lot_id} not found in portfolio` }],
                details: null,
              };
            }
            const removed = service.removePortfolioLot(args.lot_id);
            if (removed == null) {
              return {
                content: [{ type: "text", text: `lot ${args.lot_id} not found in portfolio` }],
                details: null,
              };
            }
            return {
              content: [
                { type: "text", text: `Removed ${removed.symbol} portfolio lot ${removed.id}` },
              ],
              details: removed,
            };
          }
          throw new Error(
            "lot_id is required for remove action. Use view to find the stable portfolio lot id.",
          );
        }

        if (args.action === "update") {
          if (args.lot_id == null) {
            return {
              content: [
                {
                  type: "text",
                  text: "lot_id is required for update action. Use view to find the lot id before updating a holding.",
                },
              ],
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
          if (updateParams.quantity != null && updateParams.quantity <= 0) {
            throw new Error("shares must be greater than 0.");
          }
          if (updateParams.avgCost != null && updateParams.avgCost <= 0) {
            throw new Error("avg_cost must be greater than 0.");
          }
          const selected = service
            .listPortfolioLots(portfolio.id)
            .find((lot) => lot.id === args.lot_id);
          if (!selected) {
            return {
              content: [{ type: "text", text: `lot ${args.lot_id} not found in portfolio` }],
              details: null,
            };
          }
          const updated = service.updatePortfolioLot(args.lot_id, updateParams);
          if (updated == null) {
            const target = args.lot_id ? `lot ${args.lot_id}` : args.symbol?.toUpperCase();
            return {
              content: [{ type: "text", text: `${target} not found in portfolio` }],
              details: null,
            };
          }
          return {
            content: [
              { type: "text", text: `Updated ${updated.symbol} portfolio lot ${updated.id}` },
            ],
            details: updated,
          };
        }

        const lots = service.listPortfolioLots(portfolio.id);
        const displayPortfolioName = portfolio.isDefault ? "Portfolio" : portfolio.name;
        if (lots.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `${displayPortfolioName} is empty. Use add action to add positions.`,
              },
            ],
            details: null,
          };
        }

        const baseCurrency = portfolio.baseCurrency ?? "USD";
        const summary = await buildPortfolioView(
          lots,
          baseCurrency,
          options.getCurrentPrice ?? getCurrentPrice,
        );
        const text = renderPortfolioView(displayPortfolioName, summary);
        return { content: [{ type: "text", text }], details: summary };
      } finally {
        if (options.closeDatabaseAfterExecute !== false) db.close();
      }
    },
  };
}

export const portfolioTrackerTool = createPortfolioTrackerTool({
  stateDatabaseFactory: initDefaultDatabase,
});
