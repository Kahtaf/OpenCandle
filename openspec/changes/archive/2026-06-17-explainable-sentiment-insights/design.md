## Context

OpenCandle already has a unified sentiment stack: source providers fetch raw data, adapters map source records into `SentinelRecord`, the scorer assigns keyword sentiment, the pipeline indexes records and computes trend/divergence, and tools format the result for the agent. The current contract is directionally useful but opaque: source tools expose scores, counts, raw items, and sometimes trend context, while users need the rationale behind the signal.

The change spans the sentiment type model, scorer metadata, pipeline aggregation, source-specific tools, the cross-source summary tool, GUI rendering, and answer-contract expectations. It should stay deterministic for v1 and avoid moving investment synthesis into providers.

This change builds on the active Twitter provider migration to `twitter-cli`. If implementation starts before that migration is archived into the base `twitter-sentiment` spec, implementers should treat `openspec/changes/replace-camoufox-with-twitter-cli/` as the current Twitter provider contract and avoid reintroducing scraper/Camoufox assumptions.

## Goals / Non-Goals

**Goals:**

- Add a shared explanation contract for sentiment source findings.
- Preserve existing score/count/trend fields for compatibility.
- Make Twitter/X, Reddit, and web/news sentiment outputs say why the source leans bullish, bearish, or mixed.
- Let `get_sentiment_summary` aggregate source findings into cross-source drivers, agreement/divergence, confidence, and caveats.
- Give the final assistant enough structured evidence to summarize the findings without guessing.
- Add fixture-backed tests and GUI/TUI proof for the improved answer shape.

**Non-Goals:**

- Do not add a new external LLM or embedding dependency for v1 insight extraction.
- Do not turn sentiment tools into buy/sell recommendation engines.
- Do not remove or rename existing public sentiment tools.
- Do not hardcode examples for SPCX or any other ticker.
- Do not solve bot/spam detection beyond lightweight quality caveats in this change.

## Decisions

### Decision: Add a shared `SentimentInsight` shape instead of source-specific ad hoc fields

All source tools should expose a common insight object containing sample size, label, confidence, positive drivers, negative drivers, mixed/neutral drivers, notable claims, representative items, and caveats. Source-specific fields may remain in metadata, but callers should be able to render the common shape without branching by provider.

The canonical placement is an additive `details.insight: SentimentInsight` field on each sentiment tool details payload. Existing legacy fields remain at their current paths. For typed provider result interfaces such as `TwitterSentimentResult` and `RedditSentimentResult`, the public type should gain the same additive `insight` property when that type is used as the tool `details` payload.

Alternatives considered:

- Keep only markdown formatting changes in each tool. Rejected because the GUI, TUI, and summary tool would still lack typed evidence.
- Add separate bespoke contracts per source. Rejected because cross-source aggregation would become fragile and repetitive.

### Decision: Generate v1 insights deterministically from existing records and scorer metadata

The first version should use keyword matches, repeated phrases, engagement, source type, timestamps, and sample composition to produce themes and confidence. This avoids new model cost, nondeterminism, and provider setup complexity.

Alternatives considered:

- Use the active chat model to summarize raw posts inside the tool. Rejected because tools should fetch/format evidence and the assistant should synthesize final prose.
- Add a dedicated LLM summarizer provider. Rejected for v1 because the current gap is structural and can be improved with deterministic evidence first.

### Decision: Preserve raw representative evidence with untrusted-content handling

Representative tweets, posts, comments, and article snippets should remain available, but insight summaries must be generated from sanitized/truncated text and rendered with existing untrusted-content safeguards.

Driver labels and notable claims derived from third-party source text are also untrusted evidence. They must be delimited or labeled before entering assistant-visible context, not only before GUI rendering.

Alternatives considered:

- Hide raw items and show only themes. Rejected because users need auditability.
- Show every scored item. Rejected because it creates noisy output and large GUI payloads.

### Decision: Compute confidence from sample quality, not from score magnitude alone

Confidence should consider sample size, source coverage, freshness, proportion of scored records, source agreement, and engagement concentration. A high absolute score from a tiny or low-signal sample should still be low confidence.

Use a structured representation: `confidence: { level: "low" | "medium" | "high"; score: number; reasons: string[] }`, where `score` is normalized from 0 to 1 and `reasons` explain downgrades.

Alternatives considered:

- Map score magnitude directly to confidence. Rejected because sentiment can be extreme but poorly supported.
- Omit confidence until bot/spam detection exists. Rejected because sample limits are already visible and should be surfaced explicitly.

### Decision: Keep final synthesis in answer contracts and prompts

The tools should return source findings and concise markdown; the final assistant answer should explain the overall read, why it leans that way, caveats, and whether it diverges from price action when quote data is available.

Alternatives considered:

- Put the complete final narrative into `get_sentiment_summary`. Rejected because it duplicates assistant responsibilities and makes multi-tool workflows harder to compose.

## Risks / Trade-offs

- Theme extraction can overstate weak keyword matches -> require representative evidence, matched-driver metadata, and confidence/caveat disclosure.
- Raw social/web text can contain prompt-injection content -> continue using untrusted text rendering and do not treat source text as instructions.
- GUI payloads can become too large -> cap representative items and driver counts while preserving full raw results already returned today.
- Deterministic v1 summaries may miss nuance -> expose method metadata and leave room for a future `method: "llm"` extension without changing the public shape.
- Existing tests may depend on exact markdown output -> prefer additive output assertions and keep existing fields stable.

## Migration Plan

1. Add additive insight types and helper functions behind the existing sentiment pipeline.
2. Extend scorer/adapters to capture matched terms and representative text metadata without changing existing scores.
3. Add source-level insight generation for Twitter/X, Reddit, and web/news tools.
4. Update `get_sentiment_summary` to aggregate source insights.
5. Update GUI tool rendering to display insights when present and fall back to current score/count cards otherwise.
6. Update answer-contract and prompt tests so sentiment responses must include why, confidence, and caveats.
7. Validate with unit tests, TUI harness, and GUI browser proof.

Rollback is straightforward because fields are additive: callers can ignore `details.insight` and retain the existing score/count/item behavior.

## Open Questions

- Should future LLM-based theme extraction be opt-in per model/provider, or should it become the default once deterministic insight extraction is in place?
- Should source confidence be persisted in `sentinel.db`, or recomputed at render time from stored records?
- Should the GUI expose raw matched terms for auditability, or only higher-level drivers and representative items?
