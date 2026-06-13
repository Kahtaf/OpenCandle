import type { DivergenceResult, SentimentSource, TrendBucket, TrendResult } from "./types.js";

const SPARKLINE_CHARS = "▁▂▃▄▅▆▇█";

export function renderSparkline(values: number[]): string {
  if (values.length === 0) return "";

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  return values
    .map((v) => {
      if (range === 0) return SPARKLINE_CHARS[3]; // middle block for flat
      const idx = Math.round(((v - min) / range) * 7);
      return SPARKLINE_CHARS[idx];
    })
    .join("");
}

export function computeTrend(
  buckets: TrendBucket[],
  source: SentimentSource | "aggregate",
): TrendResult {
  const scores = buckets.map((b) => b.avgScore);
  const totalCount = buckets.reduce((sum, b) => sum + b.count, 0);
  const avgScore =
    totalCount === 0 ? 0 : buckets.reduce((sum, b) => sum + b.avgScore * b.count, 0) / totalCount;

  const sparkline = renderSparkline(scores);

  // Delta: last value minus first value
  const delta = scores.length >= 2 ? scores[scores.length - 1] - scores[0] : 0;

  let direction: "rising" | "falling" | "stable";
  if (delta > 0.1) direction = "rising";
  else if (delta < -0.1) direction = "falling";
  else direction = "stable";

  return { source, sparkline, avgScore, count: totalCount, direction, delta };
}

export interface SourceStats {
  avg: number;
  count: number;
}

export function computeDivergence(
  sources: {
    twitter?: SourceStats;
    reddit?: SourceStats;
    web?: SourceStats;
    finnhub?: SourceStats;
  },
  threshold: number,
): DivergenceResult {
  const retailSources: SourceStats[] = [];
  if (sources.twitter && sources.twitter.count >= 5) retailSources.push(sources.twitter);
  if (sources.reddit && sources.reddit.count >= 5) retailSources.push(sources.reddit);

  const newsSources: SourceStats[] = [];
  if (sources.web && sources.web.count >= 5) newsSources.push(sources.web);
  if (sources.finnhub && sources.finnhub.count >= 5) newsSources.push(sources.finnhub);

  if (retailSources.length === 0 || newsSources.length === 0) {
    return {
      detected: false,
      retailAvg: null,
      newsAvg: null,
      gap: null,
      message: "Insufficient data for divergence analysis",
    };
  }

  const retailAvg = retailSources.reduce((sum, s) => sum + s.avg, 0) / retailSources.length;
  const newsAvg = newsSources.reduce((sum, s) => sum + s.avg, 0) / newsSources.length;
  const gap = Math.abs(retailAvg - newsAvg);

  if (gap > threshold) {
    return {
      detected: true,
      retailAvg,
      newsAvg,
      gap,
      message: `⚠ DIVERGENCE: Retail sentiment (${retailAvg >= 0 ? "+" : ""}${retailAvg.toFixed(2)}) vs news sentiment (${newsAvg >= 0 ? "+" : ""}${newsAvg.toFixed(2)}) — gap of ${gap.toFixed(2)}.`,
    };
  }

  return {
    detected: false,
    retailAvg,
    newsAvg,
    gap,
    message: "Sources broadly aligned",
  };
}
