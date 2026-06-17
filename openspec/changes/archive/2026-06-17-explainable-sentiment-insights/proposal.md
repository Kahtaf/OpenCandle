## Why

The current sentiment tools prove source plumbing and return directional scores, but they do not explain why a source is bullish or bearish. Users need source-specific themes, representative evidence, confidence, and caveats so sentiment can support analysis instead of acting as an opaque score.

## What Changes

- Add a shared explainable sentiment insight shape that can describe bullish drivers, bearish drivers, mixed/neutral themes, notable claims, representative items, confidence, and caveats.
- Extend Twitter/X, Reddit, and web/news sentiment outputs so each source reports why its score moved, not only score/count/raw items.
- Upgrade cross-source sentiment summaries to aggregate source-level explanations into a concise findings summary, agreement/divergence notes, and data-quality caveats.
- Preserve the existing fetch-first, index-always sentiment pipeline and keep final investment synthesis in the assistant answer, not inside providers.
- Update GUI/tool-output consumers to display source findings and representative evidence when present while keeping backward-compatible score/count fields.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sentiment-pipeline`: add explainable insight generation and typed summary metadata over existing scored records.
- `sentiment-summary`: require cross-source summaries to include key findings, bullish/bearish drivers, confidence, source agreement, and caveats.
- `twitter-sentiment`: require Twitter/X sentiment results to expose score rationale, representative tweets, and confidence/sample caveats.
- `web-sentiment`: require web/news sentiment results to expose headline/snippet drivers, notable claims, representative articles, and confidence/sample caveats.
- `reddit-comments`: require Reddit sentiment to expose post/comment themes, representative discussions, and confidence/sample caveats across subreddits.
- `pi-synced-gui`: require GUI tool-output rendering to display sentiment insights, representative evidence, scoring sample sizes, and preview counts without implying previews are the full sample.

## Impact

- Affected code: `src/types/sentiment.ts` for public sentiment result/insight types; `src/sentiment/types.ts` for scorer/pipeline-internal record metadata; sentiment scorer/pipeline modules; source adapters; `src/tools/sentiment/*`; prompt/context builder tests; answer-contract tests; GUI tool-output rendering.
- API impact: sentiment tool `details` payloads gain additive `insight` fields; existing score, count, item, and trend fields remain available for compatibility.
- Test impact: add fixture-backed unit tests for insight extraction, source tool formatting, cross-source summary aggregation, GUI rendering, and TUI/GUI harness proof for a sentiment prompt.
- No new external provider dependency is required for the first version; insight extraction is deterministic and based on existing fetched records and scorer metadata.
- Dependency: this change assumes `replace-camoufox-with-twitter-cli` has landed or remains active, so Twitter/X setup and caveats refer to the external `twitter-cli` provider path rather than the stale scraper/Camoufox base spec.
