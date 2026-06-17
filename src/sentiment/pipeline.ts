import type { SentimentConfig } from "../config.js";
import { buildSentimentInsight } from "./insights.js";
import { scoreRecords } from "./scorer.js";
import type { SentimentStore } from "./store.js";
import { computeDivergence, computeTrend, type SourceStats } from "./trends.js";
import type {
  DivergenceResult,
  SentimentSource,
  SentimentSummary,
  SentinelRecord,
  TrendResult,
} from "./types.js";

export class SentimentPipeline {
  constructor(
    private store: SentimentStore,
    private config: SentimentConfig,
  ) {}

  async processRecords(records: SentinelRecord[], query: string): Promise<SentimentSummary> {
    const warnings: string[] = [];

    if (records.length === 0) {
      return { fresh: [], trend: null, divergence: null, warnings };
    }

    // Check if store had prior data before this fetch
    const priorSeries = this.store.getTimeSeries(query, { days: 30, bucketHours: 24 });
    const hadPriorData = priorSeries.length >= 2;

    // Score all records
    const scored = scoreRecords(records);

    // Insert into store
    this.store.insert(scored);

    // Compute trend from historical data (only if we had prior data)
    let trend: TrendResult[] | null = null;
    if (hadPriorData) {
      const series = this.store.getTimeSeries(query, { days: 7, bucketHours: 24 });
      if (series.length >= 2) {
        trend = [computeTrend(series, "aggregate")];
      }
    }

    // Compute divergence from fresh records
    let divergence: DivergenceResult | null = null;
    const sourceGroups = groupBySource(scored);
    const sourceStats: {
      twitter?: SourceStats;
      reddit?: SourceStats;
      web?: SourceStats;
      finnhub?: SourceStats;
    } = {};

    for (const [source, recs] of Object.entries(sourceGroups)) {
      // Exclude comments from divergence calculation
      const postLevel = recs.filter((r) => !r.metadata.isComment);
      if (postLevel.length > 0) {
        const avg = postLevel.reduce((sum, r) => sum + r.sentiment.score, 0) / postLevel.length;
        sourceStats[source as SentimentSource] = { avg, count: postLevel.length };
      }
    }

    if (Object.keys(sourceStats).length >= 2) {
      divergence = computeDivergence(sourceStats, this.config.divergenceThreshold);
    }

    return {
      fresh: scored,
      trend,
      divergence,
      warnings,
      insight: buildSentimentInsight({
        query,
        records: scored,
        config: this.config,
        aggregate: true,
      }),
    };
  }
}

function groupBySource(records: SentinelRecord[]): Record<string, SentinelRecord[]> {
  const groups: Record<string, SentinelRecord[]> = {};
  for (const r of records) {
    if (!groups[r.source]) groups[r.source] = [];
    groups[r.source].push(r);
  }
  return groups;
}
