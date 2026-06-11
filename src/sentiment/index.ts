export type {
  SentinelRecord,
  SentinelEngagement,
  SentinelSentiment,
  SentimentAdapter,
  ScorerOptions,
  TrendBucket,
  TrendResult,
  DivergenceResult,
  SentimentSummary,
  SentimentSource,
} from "./types.js";

export { isSentinelRecord, SENTIMENT_SOURCES } from "./types.js";
export { SentimentStore } from "./store.js";
export { scoreRecords, keywordScore } from "./scorer.js";
export { SentimentPipeline } from "./pipeline.js";
export { renderSparkline, computeTrend, computeDivergence } from "./trends.js";
export { BULLISH_TERMS, BEARISH_TERMS } from "./keywords.js";
export { TwitterAdapter } from "./adapters/twitter.js";
export { RedditAdapter } from "./adapters/reddit.js";
export { WebAdapter } from "./adapters/web.js";

import { SentimentStore } from "./store.js";
import { SentimentPipeline } from "./pipeline.js";
import { getConfig } from "../config.js";
import { resolveOpenCandlePath } from "../infra/opencandle-paths.js";

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
    _pipeline = new SentimentPipeline(store, config.sentiment!);
  }
  return _pipeline;
}
