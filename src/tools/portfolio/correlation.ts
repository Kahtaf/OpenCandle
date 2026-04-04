import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getHistory } from "../../providers/yahoo-finance.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { computeDailyReturns } from "./risk-analysis.js";
import type { OHLCV } from "../../types/market.js";

export function computeCorrelation(returnsA: number[], returnsB: number[]): number {
  const n = Math.min(returnsA.length, returnsB.length);
  if (n === 0) return 0;

  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += returnsA[i];
    sumB += returnsB[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const dA = returnsA[i] - meanA;
    const dB = returnsB[i] - meanB;
    cov += dA * dB;
    varA += dA * dA;
    varB += dB * dB;
  }

  if (varA === 0 || varB === 0) return 0;
  return cov / Math.sqrt(varA * varB);
}

const DEFAULT_MIN_OVERLAP = 20;

export function alignReturnsByDate(
  historiesBySymbol: Map<string, OHLCV[]>,
  minOverlap: number = DEFAULT_MIN_OVERLAP,
): Map<string, number[]> {
  // Build date → close price maps for each symbol
  const priceByDate = new Map<string, Map<string, number>>();
  for (const [symbol, bars] of historiesBySymbol) {
    const dateMap = new Map<string, number>();
    for (const bar of bars) {
      dateMap.set(bar.date, bar.close);
    }
    priceByDate.set(symbol, dateMap);
  }

  // Find common dates across all symbols
  const symbols = [...historiesBySymbol.keys()];
  const firstDates = priceByDate.get(symbols[0])!;
  const commonDates = [...firstDates.keys()].filter((date) =>
    symbols.every((s) => priceByDate.get(s)!.has(date)),
  ).sort();

  if (commonDates.length < minOverlap) {
    throw new Error(
      `Insufficient date overlap for correlation: ${commonDates.length} common dates (need ${minOverlap}+). Symbols may trade on different exchanges or have sparse history.`,
    );
  }

  // Extract aligned close prices, then compute returns
  const result = new Map<string, number[]>();
  for (const symbol of symbols) {
    const dateMap = priceByDate.get(symbol)!;
    const alignedCloses = commonDates.map((d) => dateMap.get(d)!);
    result.set(symbol, computeDailyReturns(alignedCloses));
  }

  return result;
}

const params = Type.Object({
  symbols: Type.Array(Type.String(), {
    description: "Array of 2+ ticker symbols to compute correlation matrix (e.g. ['AAPL','MSFT','GOOGL'])",
    minItems: 2,
  }),
  period: Type.Optional(
    Type.String({ description: "Historical period: 6mo, 1y, 2y. Default: 1y" }),
  ),
});

export const correlationTool: AgentTool<typeof params> = {
  name: "analyze_correlation",
  label: "Correlation Matrix",
  description:
    "Compute pairwise return correlations between 2+ stocks. Identifies highly correlated positions (|r| > 0.7) as concentration risk. Useful for portfolio diversification analysis.",
  parameters: params,
  async execute(toolCallId, args) {
    const symbols = args.symbols.map((s) => s.toUpperCase());
    const period = args.period ?? "1y";

    if (symbols.length < 2) {
      throw new Error("Need at least 2 symbols for correlation analysis.");
    }

    // Fetch history for all symbols in parallel
    const results = await Promise.all(
      symbols.map(async (s) => ({
        symbol: s,
        result: await wrapProvider("yahoo", () => getHistory(s, period, "1d")),
      })),
    );

    const unavailable = results.filter((r) => r.result.status === "unavailable");
    if (unavailable.length === results.length) {
      return {
        content: [{ type: "text", text: `⚠ Correlation analysis unavailable — could not fetch history for any symbol.` }],
        details: null as any,
      };
    }

    const historiesBySymbol = new Map<string, OHLCV[]>();
    for (const { symbol: sym, result: r } of results) {
      if (r.status === "ok") historiesBySymbol.set(sym, r.data);
    }

    const returnsBySymbol = alignReturnsByDate(historiesBySymbol);

    // Build correlation matrix
    const matrix: Record<string, Record<string, number>> = {};
    const warnings: string[] = [];

    for (const a of symbols) {
      matrix[a] = {};
      for (const b of symbols) {
        if (a === b) {
          matrix[a][b] = 1.0;
        } else if (matrix[b]?.[a] != null) {
          matrix[a][b] = matrix[b][a];
        } else {
          const r = computeCorrelation(returnsBySymbol.get(a)!, returnsBySymbol.get(b)!);
          matrix[a][b] = r;
          if (Math.abs(r) > 0.7 && a < b) {
            warnings.push(`${a}/${b}: r=${r.toFixed(2)} — high correlation, concentration risk`);
          }
        }
      }
    }

    // Format output
    const header = `**Correlation Matrix** (${period} daily returns)`;
    const colHeader = `${"".padEnd(8)} ${symbols.map((s) => s.padStart(8)).join("")}`;
    const rows = symbols.map((a) => {
      const cells = symbols.map((b) => matrix[a][b].toFixed(2).padStart(8));
      return `${a.padEnd(8)} ${cells.join("")}`;
    });

    const lines = [header, "", colHeader, ...rows];
    if (warnings.length > 0) {
      lines.push("", "**Concentration Warnings:**");
      for (const w of warnings) lines.push(`  - ${w}`);
    } else {
      lines.push("", "No high-correlation pairs detected. Portfolio appears diversified.");
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: { matrix, warnings },
    };
  },
};
