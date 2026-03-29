import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getHistory } from "../../providers/yahoo-finance.js";
import { computeDailyReturns } from "./risk-analysis.js";

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
      return {
        content: [{ type: "text", text: "Error: Need at least 2 symbols for correlation analysis." }],
        details: null,
      };
    }

    // Fetch history for all symbols in parallel
    const histories = await Promise.all(
      symbols.map((s) => getHistory(s, period, "1d")),
    );

    const returnsBySymbol = new Map<string, number[]>();
    for (let i = 0; i < symbols.length; i++) {
      const closes = histories[i].map((b) => b.close);
      returnsBySymbol.set(symbols[i], computeDailyReturns(closes));
    }

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
