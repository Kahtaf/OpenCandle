## 1. Shared Contract and Scorer Evidence

- [x] 1.1 Add fixture-backed unit tests for the shared sentiment insight shape and confidence/caveat behavior.
- [x] 1.2 Add shared `SentimentInsight`, driver, representative item, source coverage, and structured confidence types in `src/types/sentiment.ts`, using `src/sentiment/types.ts` only for scorer/pipeline-internal metadata.
- [x] 1.3 Extend scorer metadata so matched bullish/bearish evidence can be traced back to records without changing existing score math.
- [x] 1.4 Implement deterministic insight helpers for drivers, notable claims, representative items, confidence, caveats, and configured caps/defaults.
- [x] 1.5 Add config defaults for `minUsefulSampleSize`, insight driver caps, representative item caps, and aggregate representative item caps.
- [x] 1.6 Verify existing sentiment pipeline, store, trend, and divergence tests still pass with additive fields.

## 2. Source Tool Insights

- [x] 2.0 Confirmed `replace-camoufox-with-twitter-cli` has landed and implementation is aligned to the archived `twitter-cli` contract.
- [x] 2.1 Add Twitter/X provider and tool tests covering bullish, bearish, mixed, low-sample, engagement-concentrated, and stale-cache insight output.
- [x] 2.2 Add Twitter/X insight output to `get_twitter_sentiment` while preserving existing `TwitterSentimentResult` fields.
- [x] 2.3 Add Reddit tool tests covering post/comment disagreement, cross-subreddit coverage, partial comment-fetch failure, and subreddit concentration.
- [x] 2.4 Add Reddit insight output to `get_reddit_sentiment` with post/comment representative evidence and coverage caveats.
- [x] 2.5 Add web/news tool tests covering catalyst drivers, risk drivers, single-source notable claims, snippet-only scoring, and source concentration.
- [x] 2.6 Add web/news insight output to `get_web_sentiment` while preserving scored result rows and trend context.

## 3. Cross-Source Summary and Answer Contract

- [x] 3.1 Add tests for `get_sentiment_summary` aggregating source insights into key positive drivers, negative drivers, mixed themes, source agreement, confidence, and caveats.
- [x] 3.2 Update `get_sentiment_summary` to consume source insights when available and fall back to legacy score/count records when not.
- [x] 3.3 Add tests for ticker-specific sentiment prompts where quote data is available and where quote data is unavailable, verifying price-action divergence is included or explicitly disclosed as unavailable.
- [x] 3.4 Update sentiment snapshot answer-contract and prompt/context tests so final answers must include why, confidence, source coverage, and data gaps.
- [x] 3.5 Add deterministic sentiment eval coverage for sentiment-only prompts to penalize score-only answers that omit rationale, while avoiding ticker-specific or phrase-specific overfitting.

## 4. GUI and TUI Presentation

- [x] 4.1 Add GUI unit tests for rendering source insights, representative evidence, scoring sample size, and preview count distinctions.
- [x] 4.2 Update GUI tool-output cards/drawers to display key drivers, caveats, confidence, and representative items when insight fields exist.
- [x] 4.3 Verify TUI markdown output remains readable and clearly distinguishes full scoring sample from representative preview items.
- [x] 4.4 Ensure untrusted tweets, posts, comments, headlines, and snippets still use existing untrusted-content rendering.
- [x] 4.5 Ensure extracted driver labels and notable claims derived from third-party source text are also labeled or delimited as untrusted evidence in GUI and assistant-visible tool output.

## 5. Verification and Documentation

- [x] 5.1 Run focused unit tests for sentiment providers, sentiment tools, answer contracts, and GUI sentiment rendering.
- [x] 5.2 Run `npm test`.
- [x] 5.3 Run TUI harness with a natural sentiment prompt and verify the final answer includes tool call evidence plus synthesized rationale.
- [x] 5.4 Run GUI in a real browser with a natural sentiment prompt and capture proof showing tool details plus final synthesized rationale.
- [x] 5.5 Run `graphify update .` after code changes.
- [x] 5.6 Update `CHANGELOG.md` with the user-visible sentiment explanation improvement.
