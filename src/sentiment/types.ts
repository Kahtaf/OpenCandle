import type { SentimentInsight } from "../types/sentiment.js";

export const SENTIMENT_SOURCES = ["twitter", "reddit", "web", "finnhub"] as const;
export type SentimentSource = (typeof SENTIMENT_SOURCES)[number];

export interface SentinelEngagement {
  score: number;
  replies: number | null;
  shares: number | null;
  views: number | null;
}

export interface SentinelSentiment {
  score: number; // -1.0 to +1.0
  confidence: number; // 0.0 to 1.0
  method: "keyword"; // v1 is keyword-only; future: "llm"
  tickers: string[];
}

export interface SentinelRecord {
  id: string;
  source: SentimentSource;
  sourceId: string;
  query: string;
  title: string | null;
  text: string;
  author: string | null;
  url: string;
  publishedAt: string | null;
  fetchedAt: string;
  engagement: SentinelEngagement;
  sentiment: SentinelSentiment;
  metadata: Record<string, unknown>;
}

export function isSentinelRecord(val: unknown): val is SentinelRecord {
  if (val === null || typeof val !== "object") return false;
  const r = val as Record<string, unknown>;

  if (typeof r.id !== "string") return false;
  if (typeof r.source !== "string" || !SENTIMENT_SOURCES.includes(r.source as SentimentSource))
    return false;
  if (typeof r.sourceId !== "string") return false;
  if (typeof r.query !== "string") return false;
  if (r.title !== null && typeof r.title !== "string") return false;
  if (typeof r.text !== "string") return false;
  if (r.author !== null && typeof r.author !== "string") return false;
  if (typeof r.url !== "string") return false;
  if (r.publishedAt !== null && typeof r.publishedAt !== "string") return false;
  if (typeof r.fetchedAt !== "string") return false;

  const eng = r.engagement;
  if (eng === null || typeof eng !== "object") return false;
  const e = eng as Record<string, unknown>;
  if (typeof e.score !== "number") return false;
  if (e.replies !== null && typeof e.replies !== "number") return false;
  if (e.shares !== null && typeof e.shares !== "number") return false;
  if (e.views !== null && typeof e.views !== "number") return false;

  const sent = r.sentiment;
  if (sent === null || typeof sent !== "object") return false;
  const s = sent as Record<string, unknown>;
  if (typeof s.score !== "number" || s.score < -1 || s.score > 1) return false;
  if (typeof s.confidence !== "number" || s.confidence < 0 || s.confidence > 1) return false;
  if (s.method !== "keyword") return false;
  if (!Array.isArray(s.tickers)) return false;

  if (r.metadata === null || typeof r.metadata !== "object") return false;

  return true;
}

export interface SentimentAdapter {
  source: SentimentSource;
  fetch(query: string, options?: { hours?: number }): Promise<SentinelRecord[]>;
}

export interface ScorerOptions {
  /** Minimum confidence for a keyword score to be considered "high confidence" */
  confidenceThreshold?: number;
}

export interface TrendBucket {
  timestamp: string;
  avgScore: number;
  count: number;
}

export interface TrendResult {
  source: SentimentSource | "aggregate";
  sparkline: string;
  avgScore: number;
  count: number;
  direction: "rising" | "falling" | "stable";
  delta: number;
}

export interface DivergenceResult {
  detected: boolean;
  retailAvg: number | null;
  newsAvg: number | null;
  gap: number | null;
  message: string;
}

export interface SentimentSummary {
  fresh: SentinelRecord[];
  trend: TrendResult[] | null;
  divergence: DivergenceResult | null;
  warnings: string[];
  insight?: SentimentInsight;
}
