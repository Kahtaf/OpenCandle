import type { SentinelRecord } from "../sentiment/types.js";

export interface FearGreedData {
  value: number;
  label: string; // "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"
  timestamp: number;
  previousClose: number;
  weekAgo: number | null;
  monthAgo: number | null;
}

export interface TwitterTweet {
  id: string;
  text: string;
  author: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number | null;
  url: string;
  created: string;
}

export type SentimentInsightMethod = "deterministic-keyword-v1" | "llm";
export type SentimentConfidenceLevel = "low" | "medium" | "high";

export interface SentimentInsightConfidence {
  level: SentimentConfidenceLevel;
  score: number; // 0.0 to 1.0
  reasons: string[];
}

export interface SentimentInsightDriver {
  label: string;
  count: number;
  polarity: "positive" | "negative" | "mixed";
  terms: string[];
  sourceIds: string[];
}

export interface SentimentRepresentativeItem {
  source: "twitter" | "reddit" | "web" | "finnhub" | "aggregate";
  sourceId: string;
  title: string | null;
  excerpt: string;
  url: string | null;
  author: string | null;
  publishedAt: string | null;
  engagement: number | null;
  score: number;
  matchedTerms: string[];
  metadata?: Record<string, unknown>;
}

export interface SentimentSourceCoverage {
  sources: string[];
  counts: Record<string, number>;
  missingSources?: string[];
  notes?: string[];
}

export interface SentimentInsight {
  label: string;
  score: number;
  sampleSize: number;
  scoredSampleSize: number;
  confidence: SentimentInsightConfidence;
  positiveDrivers: SentimentInsightDriver[];
  negativeDrivers: SentimentInsightDriver[];
  mixedDrivers: SentimentInsightDriver[];
  notableClaims: string[];
  representativeItems: SentimentRepresentativeItem[];
  sourceCoverage: SentimentSourceCoverage;
  caveats: string[];
  method: SentimentInsightMethod;
}

export interface TwitterSentimentResult {
  query: string;
  tweetCount: number;
  tweets: TwitterTweet[];
  sentimentScore: number; // -1.0 (fully bearish) to +1.0 (fully bullish)
  bullishCount: number;
  bearishCount: number;
  topMentions: string[];
  fetchedAt: string;
  insight?: SentimentInsight;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Domain extracted from url (e.g., "reuters.com") */
  source: string;
  /** ISO 8601 timestamp, null if unknown */
  published: string | null;
  category: "news" | "general";
}

export interface WebSearchEnvelope {
  query: string;
  results: WebSearchResult[];
  resultCount: number;
  fetchedAt: string;
  provider: "ddg" | "brave" | "exa";
}

export interface RedditSentimentResult {
  subreddit: string;
  postCount: number;
  posts: Array<{
    id: string;
    title: string;
    selftext: string;
    author: string;
    score: number;
    comments: number;
    url: string;
    created: string;
  }>;
  topMentions: string[];
  sentimentScore: number; // -1.0 (fully bearish) to +1.0 (fully bullish)
  bullishCount: number;
  bearishCount: number;
  fetchedAt: string;
  insight?: SentimentInsight;
  records?: SentinelRecord[];
}
