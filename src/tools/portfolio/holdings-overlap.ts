import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { getFundHoldings } from "../../providers/yahoo-finance.js";
import type {
  FundHolding,
  FundHoldings,
  FundHoldingsOverlap,
  FundOverlapPair,
  SharedFundHolding,
} from "../../types/portfolio.js";

const params = Type.Object({
  symbols: Type.Array(Type.String(), {
    description:
      "Array of 2+ ETF or fund ticker symbols to compare holdings overlap, e.g. ['VOO','QQQ']",
    minItems: 2,
  }),
});

export const holdingsOverlapTool: AgentTool<typeof params, FundHoldingsOverlap | null> = {
  name: "analyze_holdings_overlap",
  label: "ETF Holdings Overlap",
  description:
    "Fetch top fund/ETF holdings and compute pairwise overlap by weight. Useful for ETF diversification and hidden concentration checks.",
  parameters: params,
  async execute(_toolCallId, args) {
    const symbols = [...new Set(args.symbols.map((symbol) => symbol.toUpperCase()))];
    if (symbols.length < 2) {
      throw new Error("Need at least 2 symbols for holdings overlap analysis.");
    }

    const results = await Promise.all(
      symbols.map(async (symbol) => ({
        symbol,
        result: await wrapProvider("yahoo", () => getFundHoldings(symbol)),
      })),
    );
    const unavailable = results.flatMap((entry) =>
      entry.result.status === "unavailable"
        ? [{ symbol: entry.symbol, reason: entry.result.reason }]
        : [],
    );
    if (unavailable.length > 0) {
      const missing = unavailable.map((entry) => `${entry.symbol}: ${entry.reason}`).join("; ");
      return {
        content: [
          {
            type: "text",
            text: `⚠ Holdings overlap unavailable for one or more funds (${missing}).`,
          },
        ],
        details: null,
      };
    }

    const funds = results.flatMap((entry) =>
      entry.result.status === "ok" ? [entry.result.data] : [],
    );
    const overlap = computeHoldingsOverlap(funds);
    return {
      content: [{ type: "text", text: formatOverlap(overlap) }],
      details: overlap,
    };
  },
};

export function computeHoldingsOverlap(funds: FundHoldings[]): FundHoldingsOverlap {
  const pairs: FundOverlapPair[] = [];
  for (let i = 0; i < funds.length; i += 1) {
    for (let j = i + 1; j < funds.length; j += 1) {
      pairs.push(computePairOverlap(funds[i], funds[j]));
    }
  }
  return { funds, pairs };
}

function computePairOverlap(a: FundHoldings, b: FundHoldings): FundOverlapPair {
  const aBySymbol = new Map(a.holdings.map((holding) => [holding.symbol, holding]));
  const sharedHoldings: SharedFundHolding[] = [];
  for (const bHolding of b.holdings) {
    const aHolding = aBySymbol.get(bHolding.symbol);
    if (!aHolding) continue;
    const overlapWeight = roundWeight(Math.min(aHolding.weight, bHolding.weight));
    sharedHoldings.push({
      symbol: bHolding.symbol,
      name: commonHoldingName(aHolding, bHolding),
      weights: {
        [a.symbol]: aHolding.weight,
        [b.symbol]: bHolding.weight,
      },
      overlapWeight,
    });
  }
  sharedHoldings.sort((left, right) => right.overlapWeight - left.overlapWeight);
  return {
    symbols: [a.symbol, b.symbol],
    overlapWeight: roundWeight(
      sharedHoldings.reduce((sum, holding) => sum + holding.overlapWeight, 0),
    ),
    sharedHoldings,
  };
}

function formatOverlap(overlap: FundHoldingsOverlap): string {
  const lines: string[] = ["**ETF/Fund Holdings Overlap**", ""];
  for (const pair of overlap.pairs) {
    lines.push(`${pair.symbols.join("/")} holdings overlap: ${formatPercent(pair.overlapWeight)}`);
    const topShared = pair.sharedHoldings.slice(0, 5);
    if (topShared.length > 0) {
      lines.push(
        `Top shared holdings: ${topShared
          .map((holding) => `${holding.symbol} (${formatPercent(holding.overlapWeight)} overlap)`)
          .join(", ")}`,
      );
    } else {
      lines.push("No shared top holdings found in provider coverage.");
    }
    lines.push("");
  }
  lines.push(
    "Provider note: overlap uses provider top-holdings coverage, not full portfolio look-through unless the provider returns all holdings.",
  );
  return lines.join("\n").trimEnd();
}

function commonHoldingName(a: FundHolding, b: FundHolding): string {
  if (a.name && a.name !== a.symbol) return a.name;
  if (b.name && b.name !== b.symbol) return b.name;
  return a.symbol;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function roundWeight(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
