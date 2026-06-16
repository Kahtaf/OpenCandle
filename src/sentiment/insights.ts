import type { SentimentConfig } from "../config.js";
import type {
  SentimentInsight,
  SentimentInsightConfidence,
  SentimentInsightDriver,
  SentimentRepresentativeItem,
} from "../types/sentiment.js";
import type { SentimentSource, SentinelRecord } from "./types.js";

const DEFAULT_MIN_SAMPLE = 10;
const DEFAULT_DRIVER_CAP = 3;
const DEFAULT_SOURCE_ITEM_CAP = 5;
const DEFAULT_AGGREGATE_ITEM_CAP = 8;
const DEFAULT_CLAIM_CAP = 5;

export interface BuildSentimentInsightOptions {
  query: string;
  records: SentinelRecord[];
  score?: number;
  label?: string;
  source?: SentimentSource | "aggregate";
  missingSources?: string[];
  sourceNotes?: string[];
  config?: Partial<SentimentConfig>;
  aggregate?: boolean;
  extraCaveats?: string[];
}

interface TermBucket {
  term: string;
  count: number;
  sourceIds: Set<string>;
}

export function buildSentimentInsight(options: BuildSentimentInsightOptions): SentimentInsight {
  const records = options.records;
  const scored = records.filter((record) => Math.abs(record.sentiment.score) > 0);
  const score =
    typeof options.score === "number"
      ? options.score
      : records.length > 0
        ? records.reduce((sum, record) => sum + record.sentiment.score, 0) / records.length
        : 0;
  const sourceCounts = countBySource(records);
  const positiveDrivers = driversFromTerms(records, "positive", options.config);
  const negativeDrivers = driversFromTerms(records, "negative", options.config);
  const caveats = buildCaveats(records, scored, sourceCounts, options);
  const confidence = buildConfidence(records, scored, sourceCounts, caveats, options.config);
  const representativeItems = representativeItemsFor(records, options);

  return {
    label: options.label ?? labelForScore(score),
    score,
    sampleSize: records.length,
    scoredSampleSize: scored.length,
    confidence,
    positiveDrivers,
    negativeDrivers,
    mixedDrivers: buildMixedDrivers(positiveDrivers, negativeDrivers, score),
    notableClaims: notableClaimsFor(records, options),
    representativeItems,
    sourceCoverage: {
      sources: Object.keys(sourceCounts),
      counts: sourceCounts,
      missingSources: options.missingSources?.filter(Boolean),
      notes: options.sourceNotes?.filter(Boolean),
    },
    caveats,
    method: "deterministic-keyword-v1",
  };
}

export function labelForScore(score: number): string {
  if (score > 0.3) return "Bullish";
  if (score < -0.3) return "Bearish";
  if (score > 0) return "Leaning Bullish";
  if (score < 0) return "Leaning Bearish";
  return "Neutral";
}

function driversFromTerms(
  records: SentinelRecord[],
  polarity: "positive" | "negative",
  config: Partial<SentimentConfig> | undefined,
): SentimentInsightDriver[] {
  const buckets = new Map<string, TermBucket>();
  const metadataKey = polarity === "positive" ? "matchedBullishTerms" : "matchedBearishTerms";

  for (const record of records) {
    const terms = stringArray(record.metadata[metadataKey]);
    for (const term of terms) {
      const existing = buckets.get(term) ?? { term, count: 0, sourceIds: new Set<string>() };
      existing.count += 1;
      existing.sourceIds.add(record.sourceId);
      buckets.set(term, existing);
    }
  }

  return [...buckets.values()]
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, config?.maxInsightDriversPerPolarity ?? DEFAULT_DRIVER_CAP)
    .map((bucket) => ({
      label: bucket.term,
      count: bucket.count,
      polarity,
      terms: [bucket.term],
      sourceIds: [...bucket.sourceIds],
    }));
}

function buildMixedDrivers(
  positiveDrivers: SentimentInsightDriver[],
  negativeDrivers: SentimentInsightDriver[],
  score: number,
): SentimentInsightDriver[] {
  if (positiveDrivers.length === 0 || negativeDrivers.length === 0) return [];
  if (Math.abs(score) > 0.3) return [];
  return [
    {
      label: "offsetting bullish and bearish evidence",
      count: Math.min(sumDriverCounts(positiveDrivers), sumDriverCounts(negativeDrivers)),
      polarity: "mixed",
      terms: [
        ...positiveDrivers.flatMap((d) => d.terms),
        ...negativeDrivers.flatMap((d) => d.terms),
      ],
      sourceIds: [
        ...new Set([
          ...positiveDrivers.flatMap((d) => d.sourceIds),
          ...negativeDrivers.flatMap((d) => d.sourceIds),
        ]),
      ],
    },
  ];
}

function representativeItemsFor(
  records: SentinelRecord[],
  options: BuildSentimentInsightOptions,
): SentimentRepresentativeItem[] {
  const cap = options.aggregate
    ? (options.config?.maxAggregateRepresentativeItems ?? DEFAULT_AGGREGATE_ITEM_CAP)
    : (options.config?.maxRepresentativeItemsPerSource ?? DEFAULT_SOURCE_ITEM_CAP);

  return [...records]
    .sort((a, b) => itemRank(b) - itemRank(a))
    .slice(0, cap)
    .map((record) => ({
      source: record.source,
      sourceId: record.sourceId,
      title: record.title,
      excerpt: excerptFor(record),
      url: record.url || null,
      author: record.author,
      publishedAt: record.publishedAt,
      engagement: Number.isFinite(record.engagement.score) ? record.engagement.score : null,
      score: record.sentiment.score,
      matchedTerms: [
        ...stringArray(record.metadata.matchedBullishTerms),
        ...stringArray(record.metadata.matchedBearishTerms),
      ],
      metadata: record.metadata,
    }));
}

function notableClaimsFor(
  records: SentinelRecord[],
  options: BuildSentimentInsightOptions,
): string[] {
  const cap = options.config?.maxNotableClaims ?? DEFAULT_CLAIM_CAP;
  const claims = new Set<string>();
  for (const record of representativeItemsFor(records, { ...options, aggregate: false })) {
    const claim = record.title ?? record.excerpt;
    if (claim) claims.add(claim);
    if (claims.size >= cap) break;
  }
  return [...claims];
}

function buildConfidence(
  records: SentinelRecord[],
  scored: SentinelRecord[],
  sourceCounts: Record<string, number>,
  caveats: string[],
  config: Partial<SentimentConfig> | undefined,
): SentimentInsightConfidence {
  const minSample = config?.minUsefulSampleSize ?? DEFAULT_MIN_SAMPLE;
  const sampleRatio = Math.min(records.length / minSample, 1);
  const scoredRatio = records.length === 0 ? 0 : scored.length / records.length;
  const coverageRatio = Math.min(Object.keys(sourceCounts).length / 3, 1);
  let score = sampleRatio * 0.4 + scoredRatio * 0.4 + coverageRatio * 0.2;
  const reasons: string[] = [];

  if (records.length < minSample) {
    reasons.push(`low sample size (${records.length}/${minSample})`);
  }
  if (scoredRatio < 0.5) {
    reasons.push("most records were neutral or had no keyword sentiment match");
  }
  if (Object.keys(sourceCounts).length <= 1) {
    reasons.push("single-source sentiment coverage");
  }
  if (caveats.length > 0) {
    score -= Math.min(0.2, caveats.length * 0.05);
  }

  score = clamp01(score);
  return {
    level: score >= 0.7 ? "high" : score >= 0.4 ? "medium" : "low",
    score,
    reasons,
  };
}

function buildCaveats(
  records: SentinelRecord[],
  scored: SentinelRecord[],
  sourceCounts: Record<string, number>,
  options: BuildSentimentInsightOptions,
): string[] {
  const minSample = options.config?.minUsefulSampleSize ?? DEFAULT_MIN_SAMPLE;
  const caveats = [...(options.extraCaveats ?? [])];
  if (records.length < minSample) caveats.push(`Low sample size: ${records.length} records.`);
  if (records.length > 0 && scored.length === 0)
    caveats.push("No records contained keyword sentiment matches.");
  if (records.length > 0 && scored.length / records.length < 0.5) {
    caveats.push("Most records were neutral or unscored by keyword matching.");
  }
  if (Object.keys(sourceCounts).length <= 1) caveats.push("Single-source sentiment coverage.");
  if (options.missingSources && options.missingSources.length > 0) {
    caveats.push(`Missing sources: ${options.missingSources.join(", ")}.`);
  }
  return [...new Set(caveats)];
}

function countBySource(records: SentinelRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    counts[record.source] = (counts[record.source] ?? 0) + 1;
  }
  return counts;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sumDriverCounts(drivers: SentimentInsightDriver[]): number {
  return drivers.reduce((sum, driver) => sum + driver.count, 0);
}

function itemRank(record: SentinelRecord): number {
  const sentimentWeight = Math.abs(record.sentiment.score) * 100;
  const confidenceWeight = record.sentiment.confidence * 20;
  const engagementWeight = Math.log10(Math.max(0, record.engagement.score) + 1);
  return sentimentWeight + confidenceWeight + engagementWeight;
}

function excerptFor(record: SentinelRecord): string {
  const raw = record.title ? `${record.title} ${record.text}` : record.text;
  const normalized = raw.replace(/\s+/g, " ").trim();
  return normalized.length > 220 ? `${normalized.slice(0, 219)}…` : normalized;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
