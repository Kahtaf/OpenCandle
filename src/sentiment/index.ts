export { RedditAdapter } from "./adapters/reddit.js";
export { TwitterAdapter } from "./adapters/twitter.js";
export { WebAdapter } from "./adapters/web.js";
export { buildSentimentInsight, labelForScore } from "./insights.js";
export { BEARISH_TERMS, BULLISH_TERMS } from "./keywords.js";
export { SentimentPipeline } from "./pipeline.js";
export { keywordScore, scoreRecords } from "./scorer.js";
export { SentimentStore } from "./store.js";
export { computeDivergence, computeTrend, renderSparkline } from "./trends.js";
export type {
  DivergenceResult,
  ScorerOptions,
  SentimentAdapter,
  SentimentSource,
  SentimentSummary,
  SentinelEngagement,
  SentinelRecord,
  SentinelSentiment,
  TrendBucket,
  TrendResult,
} from "./types.js";
export { isSentinelRecord, SENTIMENT_SOURCES } from "./types.js";

import { getConfig } from "../config.js";
import { resolveOpenCandlePath } from "../infra/opencandle-paths.js";
import { SentimentPipeline } from "./pipeline.js";
import { SentimentStore } from "./store.js";

let _pipeline: SentimentPipeline | null = null;
let _store: SentimentStore | null = null;

export function getSentimentStore(): SentimentStore {
  if (!_store) {
    const dbPath = resolveOpenCandlePath("sentinel.db");
    _store = new SentimentStore(dbPath);
    const config = getConfig();
    _store.prune(config.sentiment?.retentionDays ?? 30);
  }
  return _store;
}

export function getSentimentPipeline(): SentimentPipeline {
  if (!_pipeline) {
    const store = getSentimentStore();
    const config = getConfig();
    const sentimentConfig = config.sentiment;
    if (!sentimentConfig) throw new Error("Sentiment configuration is missing.");
    _pipeline = new SentimentPipeline(store, sentimentConfig);
  }
  return _pipeline;
}
