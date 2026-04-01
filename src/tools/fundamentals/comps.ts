import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getOverview } from "../../providers/alpha-vantage.js";
import { getConfig } from "../../config.js";
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
      .filter(([, v]) => v != null)
      .map(([sym, v]) => ({ sym, v: v! }));

    const sorted = [...nonNull].sort((a, b) => a.v - b.v);
    const sortedVals = sorted.map((s) => s.v);
    const median = computeMedian(sortedVals);
    const p25 = computePercentile(sortedVals, 0.25);
    const p75 = computePercentile(sortedVals, 0.75);

    const best = def.lowerIsBetter ? sorted[0]?.sym ?? "" : sorted[sorted.length - 1]?.sym ?? "";
    const worst = def.lowerIsBetter ? sorted[sorted.length - 1]?.sym ?? "" : sorted[0]?.sym ?? "";

    return { metric: def.name, values, median, p25, p75, best, worst };
  });

  return { companies, metrics, unavailableSymbols: [] };
}

function computeMedian(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
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
  async execute(toolCallId, args) {
    const config = getConfig();
    if (!config.alphaVantageApiKey) {
      throw new Error("Alpha Vantage API key not configured. Set ALPHA_VANTAGE_API_KEY or add ~/.opencandle/config.json.");
    }

    const symbols = args.symbols.map((s) => s.toUpperCase());

    const settled = await Promise.allSettled(
      symbols.map(async (s) => ({ symbol: s, overview: await getOverview(s, config.alphaVantageApiKey!) })),
    );

    const companies: CompanyOverview[] = [];
    const unavailableSymbols: string[] = [];

    for (const [index, result] of settled.entries()) {
      if (result.status === "fulfilled") {
        companies.push(result.value.overview);
        continue;
      }
      unavailableSymbols.push(symbols[index]);
    }

    if (companies.length === 0) {
      throw new Error(`Unable to fetch comparable-company fundamentals for: ${symbols.join(", ")}`);
    }

    const result = computeComps(companies);
    result.unavailableSymbols = unavailableSymbols;

    const availableSymbols = companies.map((company) => company.symbol);
    const header = `**Comparable Company Analysis**: ${availableSymbols.join(" vs ")}`;
    const rows = result.metrics.map((m) => {
      const vals = availableSymbols.map((s) => {
        const v = m.values[s];
        if (v == null) return "N/A".padStart(10);
        if (Math.abs(v) < 1) return `${(v * 100).toFixed(1)}%`.padStart(10);
        return v.toFixed(2).padStart(10);
      });
      const medStr = m.median != null
        ? (Math.abs(m.median) < 1 ? `${(m.median * 100).toFixed(1)}%` : m.median.toFixed(2))
        : "N/A";
      return `  ${m.metric.padEnd(16)} ${vals.join("")}  Med: ${medStr}  Best: ${m.best}`;
    });

    const symHeader = `  ${"Metric".padEnd(16)} ${availableSymbols.map((s) => s.padStart(10)).join("")}`;
    const noteLines = unavailableSymbols.length > 0
      ? ["", `Unavailable fundamentals: ${unavailableSymbols.join(", ")}`]
      : [];
    const text = [header, "", symHeader, ...rows, ...noteLines].join("\n");

    return { content: [{ type: "text", text }], details: result };
  },
};
