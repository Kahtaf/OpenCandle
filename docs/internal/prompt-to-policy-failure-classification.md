# Competitive Failure Classification

Date: 2026-05-24

This classifies recurring competitive losses so future fixes land in the narrowest durable layer instead of becoming new global prompt clauses by default.

| Prompt or patch | Source | Primary layer | Secondary layer | Classification note | Current status |
| --- | --- | --- | --- | --- | --- |
| `brokerage-choice-taxable` | `docs/internal/competitive-benchmark-history.md` 2026-05-24 batch | `tool-capability` | `answer-contract` | OpenCandle punted because no brokerage comparison tool existed. The immediate fix was durable retail-tradeoff answer obligations; long-term parity requires a brokerage/cash/yield capability. | Prompt-protected; capability gap `brokerage_comparison`. |
| `dividend-vs-growth-etfs` | 2026-05-24 batch | `routing` | `planning` | Tradeoff/comparison wording was over-routed to portfolio construction. Router correction now maps explicit multi-ETF tradeoffs to compare-assets; planner should preserve `compare_tradeoffs`. | Router correction active; future `asset_compare` plan. |
| `ambiguous-ticker-lookup` / ARMH | 2026-05-24 batch | `evidence-plan` | `answer-contract` | The answer needed ticker disambiguation before business-model explanation. A global clause patched this; V1 candidate is `ticker_disambiguation`. | Prompt-protected; candidate first slice. |
| `earnings-event-risk-today` unknown ticker | 2026-05-24 batch | `answer-contract` | `tool-capability` | Unknown ticker stopped the answer. Replacement should disclose unresolved symbol and provide event-risk framework without inventing facts. | Prompt-protected; capability gap `earnings_event_risk`. |
| `etf-overlap-check` | 2026-05-24 batch | `tool-capability` | `evidence-plan` | Generic compare metrics cannot compute exact holdings overlap by weight. Disclosing the gap is honest but not specialist-competitive. | Capability gap `etf_holdings_overlap`; prompt guidance active. |
| `crypto-position-sizing` | 2026-05-24 batch | `answer-contract` | `structured-check` | Sizing answer lacked drawdown math and implementation obligations. Replacement should be a contract/check, not a broader prompt clause. | Prompt-protected; future contract. |
| BA `moved today` | 2026-05-24 batch | `evidence-plan` | `structured-check` | Current-event answers need market-status evidence before causal claims. | Prompt-protected; future `market_status` evidence plan. |
| Codex ACP stale model syntax | 2026-05-24 batch | `judge/harness` | none | Harness adapter configuration caused competitor baseline instability, not OpenCandle product behavior. | Fixed in harness/docs; not a planning concern. |
| Malformed judge JSON | 2026-05-24 batch | `judge/harness` | none | Benchmark parser needed retry/repair; not a product prompt issue. | Fixed in competitive runner. |
| Alpha Vantage burst on ASML comparison | 2026-05-23 graphify gap | `tool-capability` | `evidence-normalization` | Provider limiter caused false missing fundamentals. Fix belonged in rate limiting, not prompts. | Fixed limiter; keep provider gap reporting. |
| Natural ticker uncertainty did not call `search_ticker` | 2026-05-23 graphify gap | `evidence-plan` | `routing` | Average-user ticker discovery needs evidence-plan expectations before prompt guidance. | Future ticker-disambiguation slice. |
| NVDA natural buy prompt over-weighted missing DCF/fundamentals | 2026-05-23 natural rerun | `answer-contract` | `evidence-normalization` | Missing valuation provider became the thesis despite other evidence. Replacement should require fallback valuation lenses and structured gap disclosure. | Prompt-protected. |
| Twitter/X cookies absent from eval home | 2026-05-23 natural rerun | `judge/harness` | `tool-capability` | Eval home seeding issue made sentiment source unavailable. | Fixed seeded browser-profile copy. |
| COIN filing thesis judge rewarded fabricated specificity | 2026-05-23 filing rerun | `judge/harness` | `answer-contract` | Judge needed anti-fabrication rule; OpenCandle still needs better filing evidence snippets. | Judge fixed; filing evidence plan deferred. |
| SPY 50/200 backtest unsupported | 2026-05-23 backtest | `tool-capability` | `answer-contract` | Tool lacked a standard strategy, causing refusal. Fix belonged in tool support plus backtest contract. | Tool fixed; richer contract deferred. |
| 60/40 macro portfolio budget clarification | 2026-05-23 macro review | `routing` | `planning` | Existing allocation evaluation was misread as portfolio construction. | Router correction active; future `portfolio_review` plan. |
| SPY/QQQ rate-cut allocation | 2026-05-21 | `evidence-plan` | `tool-capability` | Needed rate-sensitive compare metric and forward-rate probability gap disclosure. | Compare metric/prompt guidance active; gap `forward_rate_probabilities`. |
| Protective-put after rally | 2026-05-21 | `routing` | `answer-contract` | Needed strategy extraction, share quantity, hedge context, and protective-put framing. | Router/workflow fixes active. |
| P/E ratio education | 2026-05-21 | `answer-contract` | `planning` | Concept education needed no-tool route and education contract, not stock-analysis shape. | Prompt-protected; harness baseline committed. |

## Layer Policy

- `routing`: route kind, workflow, entity, slot, or follow-up context selection.
- `planning`: task-family or commitment-mode selection once the planning scaffold exists.
- `evidence-plan`: missing or wrong evidence requirements after route selection.
- `tool-capability`: OpenCandle lacks data, provider, computation, or tool behavior.
- `evidence-normalization`: tool/provider output exists but is not represented clearly enough for synthesis/checks.
- `answer-contract`: final-answer obligations are missing or wrong for the task.
- `structured-check`: measurable obligation should be observed or gated.
- `retry-eligibility`: future corrective retry may be appropriate but is not active in V1.
- `synthesis`: route/plan/evidence are correct but prose quality fails.
- `judge/harness`: benchmark or evaluator instability outside product behavior.
