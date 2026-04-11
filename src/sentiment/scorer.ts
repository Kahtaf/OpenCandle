import { BULLISH_TERMS, BEARISH_TERMS } from "./keywords.js";
import type { SentinelRecord } from "./types.js";

const TICKER_REGEX = /\$([A-Z]{1,5})\b/g;

interface ScoreResult {
  score: number;
  confidence: number;
  tickers: string[];
}

export function keywordScore(record: SentinelRecord): ScoreResult {
  const lower = record.text.toLowerCase();
  const engagement = 1 + (record.engagement.score ?? 0);

  let bullishWeight = 0;
  let bearishWeight = 0;
  let bullishCount = 0;
  let bearishCount = 0;

  for (const term of BULLISH_TERMS) {
    if (lower.includes(term)) {
      bullishCount++;
      bullishWeight += engagement;
    }
  }

  for (const term of BEARISH_TERMS) {
    if (lower.includes(term)) {
      bearishCount++;
      bearishWeight += engagement;
    }
  }

  const totalWeight = bullishWeight + bearishWeight;
  const score = totalWeight === 0 ? 0 : (bullishWeight - bearishWeight) / totalWeight;

  const totalMatches = bullishCount + bearishCount;
  let confidence = 0;
  if (totalMatches > 0) {
    // Base confidence from keyword matches
    confidence = Math.min(totalMatches / 5, 1) * 0.6;
    // Boost for longer text
    const textLength = record.text.length;
    confidence += Math.min(textLength / 500, 1) * 0.3;
    // Multiple matches boost
    if (totalMatches >= 3) confidence += 0.1;
    // Twitter penalty
    if (record.source === "twitter") confidence -= 0.1;
    // Clamp
    confidence = Math.max(0, Math.min(1, confidence));
  }

  // Extract tickers
  const tickers: string[] = [];
  for (const match of record.text.matchAll(TICKER_REGEX)) {
    if (!tickers.includes(match[1])) {
      tickers.push(match[1]);
    }
  }

  return { score, confidence, tickers };
}

export function scoreRecords(records: SentinelRecord[]): SentinelRecord[] {
  return records.map((record) => {
    const result = keywordScore(record);
    return {
      ...record,
      sentiment: {
        score: result.score,
        confidence: result.confidence,
        method: "keyword" as const,
        tickers: result.tickers,
      },
    };
  });
}
