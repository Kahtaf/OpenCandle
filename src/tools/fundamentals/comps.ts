import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { getConfig } from "../../config.js";
import { withCredentialCheck } from "../../onboarding/tool-helpers.js";
import { getOverview } from "../../providers/alpha-vantage.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { getYahooCompanyOverview } from "../../providers/yahoo-finance.js";
import type { CompanyOverview } from "../../types/fundamentals.js";

export interface CompsMetric {
  metric: string;
  values: Record<string, number | null>;
  median: number | null;
  p25: number | null;
  p75: number | null;
  best: string;
  worst: string;
}

export interface CompsResult {
  companies: CompanyOverview[];
  metrics: CompsMetric[];
  unavailableSymbols: string[];
  unavailableReasons: Record<string, string>;
}

type MetricDef = {
  name: string;
  extract: (c: CompanyOverview) => number | null;
  lowerIsBetter: boolean;
};

const METRIC_DEFS: MetricDef[] = [
  { name: "P/E", extract: (c) => c.pe, lowerIsBetter: true },
  { name: "Forward P/E", extract: (c) => c.forwardPe, lowerIsBetter: true },
  { name: "EPS", extract: (c) => c.eps, lowerIsBetter: false },
  { name: "Profit Margin", extract: (c) => c.profitMargin, lowerIsBetter: false },
  { name: "Revenue Growth", extract: (c) => c.revenueGrowth, lowerIsBetter: false },
  { name: "Dividend Yield", extract: (c) => c.dividendYield, lowerIsBetter: false },
  { name: "Beta", extract: (c) => c.beta, lowerIsBetter: true },
];

export function computeComps(companies: CompanyOverview[]): CompsResult {
  const metrics: CompsMetric[] = METRIC_DEFS.map((def) => {
    const values: Record<string, number | null> = {};
    for (const c of companies) {
      values[c.symbol] = def.extract(c);
    }

    const nonNull = Object.entries(values)
      .filter((entry): entry is [string, number] => entry[1] != null)
      .map(([sym, v]) => ({ sym, v }));

    const sorted = [...nonNull].sort((a, b) => a.v - b.v);
    const sortedVals = sorted.map((s) => s.v);
    const median = computeMedian(sortedVals);
    const p25 = computePercentile(sortedVals, 0.25);
    const p75 = computePercentile(sortedVals, 0.75);

    const best = def.lowerIsBetter
      ? (sorted[0]?.sym ?? "")
      : (sorted[sorted.length - 1]?.sym ?? "");
    const worst = def.lowerIsBetter
      ? (sorted[sorted.length - 1]?.sym ?? "")
      : (sorted[0]?.sym ?? "");

    return { metric: def.name, values, median, p25, p75, best, worst };
  });

  return { companies, metrics, unavailableSymbols: [], unavailableReasons: {} };
}

function computeMedian(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function computePercentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

const params = Type.Object({
  symbols: Type.Array(Type.String(), {
    description: "Array of 2-6 ticker symbols to compare (e.g. ['AAPL','MSFT','GOOGL'])",
    minItems: 2,
    maxItems: 6,
  }),
});

export const compsTool: AgentTool<typeof params> = {
  name: "compare_companies",
  label: "Comparable Company Analysis",
  description:
    "Compare 2-6 companies side-by-side on key valuation and financial metrics: P/E, Forward P/E, EPS, Profit Margin, Revenue Growth, Dividend Yield, Beta. Identifies the cheapest and most expensive on each metric.",
  parameters: params,
  async execute(_toolCallId, args) {
    return withCredentialCheck("alpha_vantage", async () => {
      const config = getConfig();
      const alphaVantageApiKey = config.alphaVantageApiKey;
      if (!alphaVantageApiKey) throw new Error("Alpha Vantage credential is missing.");
      const symbols = args.symbols.map((s) => s.toUpperCase());

      const companies: CompanyOverview[] = [];
      const unavailableSymbols: string[] = [];
      const unavailableReasons: Record<string, string> = {};

      for (const sym of symbols) {
        const alphaResult = await wrapProvider("alphavantage", () =>
          getOverview(sym, alphaVantageApiKey),
        );
        if (alphaResult.status === "ok") {
          companies.push(alphaResult.data);
          continue;
        }

        const yahooResult = await wrapProvider("yahoo", () => getYahooCompanyOverview(sym));
        if (yahooResult.status === "ok") {
          companies.push(yahooResult.data);
        } else {
          unavailableSymbols.push(sym);
          unavailableReasons[sym] =
            `Alpha Vantage: ${alphaResult.reason}; Yahoo Finance: ${yahooResult.reason}`;
        }
      }

      if (companies.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `⚠ Company fundamentals unavailable for all symbols: ${symbols.join(", ")}. Alpha Vantage may be rate limited.`,
            },
          ],
          details: null,
        };
      }

      const result = computeComps(companies);
      result.unavailableSymbols = unavailableSymbols;
      result.unavailableReasons = unavailableReasons;

      const availableSymbols = companies.map((company) => company.symbol);
      const header = `**Comparable Company Analysis**: ${availableSymbols.join(" vs ")}`;
      const rows = result.metrics.map((m) => {
        const vals = availableSymbols.map((s) => {
          const v = m.values[s];
          if (v == null) return "N/A".padStart(10);
          if (Math.abs(v) < 1) return `${(v * 100).toFixed(1)}%`.padStart(10);
          return v.toFixed(2).padStart(10);
        });
        const medStr =
          m.median != null
            ? Math.abs(m.median) < 1
              ? `${(m.median * 100).toFixed(1)}%`
              : m.median.toFixed(2)
            : "N/A";
        return `  ${m.metric.padEnd(16)} ${vals.join("")}  Med: ${medStr}  Best: ${m.best}`;
      });

      const symHeader = `  ${"Metric".padEnd(16)} ${availableSymbols.map((s) => s.padStart(10)).join("")}`;
      const noteLines =
        unavailableSymbols.length > 0
          ? ["", `Unavailable fundamentals: ${unavailableSymbols.join(", ")}`]
          : [];
      const reasonLines =
        unavailableSymbols.length > 0
          ? unavailableSymbols.map((symbol) => `  - ${symbol} (${unavailableReasons[symbol]})`)
          : [];
      const text = [header, "", symHeader, ...rows, ...noteLines].join("\n");
      const textWithReasons = reasonLines.length > 0 ? `${text}\n${reasonLines.join("\n")}` : text;

      return { content: [{ type: "text", text: textWithReasons }], details: result };
    });
  },
};
