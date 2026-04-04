import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getQuote } from "../../providers/yahoo-finance.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import type { Position, PortfolioSummary } from "../../types/portfolio.js";
import { ensureParentDir, getPortfolioPath } from "../../infra/opencandle-paths.js";

function loadPortfolio(): Position[] {
  const portfolioPath = getPortfolioPath();
  if (!existsSync(portfolioPath)) return [];
  try {
    return JSON.parse(readFileSync(portfolioPath, "utf-8"));
  } catch {
    return [];
  }
}

function savePortfolio(positions: Position[]): void {
  const portfolioPath = getPortfolioPath();
  ensureParentDir(portfolioPath);
  writeFileSync(portfolioPath, JSON.stringify(positions, null, 2));
}

async function getCurrentPrice(symbol: string): Promise<number | null> {
  const result = await wrapProvider("yahoo", () => getQuote(symbol));
  if (result.status === "unavailable") return null;
  return result.data.price;
}

const params = Type.Object({
  action: Type.Union([
    Type.Literal("add"),
    Type.Literal("remove"),
    Type.Literal("view"),
  ], { description: "Action: add a position, remove a position, or view portfolio" }),
  symbol: Type.Optional(
    Type.String({ description: "Ticker symbol — stocks (AAPL, MSFT) or crypto with -USD suffix (BTC-USD, ETH-USD, SOL-USD). Use search_ticker to find the right ticker." }),
  ),
  shares: Type.Optional(
    Type.Number({ description: "Number of shares/units (required for add)" }),
  ),
  avg_cost: Type.Optional(
    Type.Number({ description: "Average cost per share/unit in USD (required for add)" }),
  ),
});

export const portfolioTrackerTool: AgentTool<typeof params, PortfolioSummary | null> = {
  name: "track_portfolio",
  label: "Portfolio Tracker",
  description:
    "Track your portfolio of stocks and crypto. Add/remove positions with cost basis, or view current holdings with live P&L. For stocks use standard tickers (AAPL, MSFT). For crypto use the -USD suffix (BTC-USD, ETH-USD, SOL-USD). Use search_ticker first if you're unsure of the exact ticker. Data persisted to ~/.opencandle/portfolio.json.",
  parameters: params,
  async execute(toolCallId, args) {
    const positions = loadPortfolio();

    if (args.action === "add") {
      if (!args.symbol || !args.shares || !args.avg_cost) {
        throw new Error("symbol, shares, and avg_cost are required for add action.");
      }
      const symbol = args.symbol.toUpperCase();
      const existing = positions.find((p) => p.symbol === symbol);
      if (existing) {
        const totalShares = existing.shares + args.shares;
        existing.avgCost =
          (existing.avgCost * existing.shares + args.avg_cost * args.shares) / totalShares;
        existing.shares = totalShares;
      } else {
        positions.push({
          symbol,
          shares: args.shares,
          avgCost: args.avg_cost,
          addedAt: new Date().toISOString(),
        });
      }
      savePortfolio(positions);
      return {
        content: [{ type: "text", text: `Added ${args.shares} shares of ${symbol} at $${args.avg_cost.toFixed(2)}` }],
        details: null,
      };
    }

    if (args.action === "remove") {
      if (!args.symbol) {
        throw new Error("symbol is required for remove action.");
      }
      const symbol = args.symbol.toUpperCase();
      const idx = positions.findIndex((p) => p.symbol === symbol);
      if (idx === -1) {
        return {
          content: [{ type: "text", text: `${symbol} not found in portfolio` }],
          details: null,
        };
      }
      positions.splice(idx, 1);
      savePortfolio(positions);
      return {
        content: [{ type: "text", text: `Removed ${symbol} from portfolio` }],
        details: null,
      };
    }

    // View portfolio
    if (positions.length === 0) {
      return {
        content: [{ type: "text", text: "Portfolio is empty. Use add action to add positions." }],
        details: null,
      };
    }

    const enriched = await Promise.all(
      positions.map(async (p) => {
        const currentPrice = await getCurrentPrice(p.symbol) ?? p.avgCost;
        const marketValue = currentPrice * p.shares;
        const totalCost = p.avgCost * p.shares;
        return {
          ...p,
          currentPrice,
          marketValue,
          totalCost,
          pnl: marketValue - totalCost,
          pnlPercent: ((marketValue - totalCost) / totalCost) * 100,
        };
      }),
    );

    const totalValue = enriched.reduce((s, p) => s + p.marketValue, 0);
    const totalCost = enriched.reduce((s, p) => s + p.totalCost, 0);

    const summary: PortfolioSummary = {
      positions: enriched,
      totalValue,
      totalCost,
      totalPnl: totalValue - totalCost,
      totalPnlPercent: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
    };

    const header = `**Portfolio** — ${enriched.length} positions | Value: $${totalValue.toFixed(2)} | P&L: $${summary.totalPnl.toFixed(2)} (${summary.totalPnlPercent >= 0 ? "+" : ""}${summary.totalPnlPercent.toFixed(2)}%)`;
    const rows = enriched.map((p) => {
      const sign = p.pnlPercent >= 0 ? "+" : "";
      return `  ${p.symbol}: ${p.shares} @ $${p.avgCost.toFixed(2)} → $${p.currentPrice.toFixed(2)} | P&L: $${p.pnl.toFixed(2)} (${sign}${p.pnlPercent.toFixed(2)}%)`;
    });

    const text = [header, ...rows].join("\n");
    return { content: [{ type: "text", text }], details: summary };
  },
};
