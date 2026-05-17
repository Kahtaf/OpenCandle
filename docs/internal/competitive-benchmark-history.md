# Competitive Benchmark History

This file records compact, committed summaries of competitive benchmark improvement loops. Raw reports stay under `tests/evals/runs/` and are ignored by git.

| Date | Prompt | Before | After | Gap | Changes | Follow-ups |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-05-17 | `btc-gld-macro-hedge-6mo`: "For the next 6 months, should I use BTC or GLD as a macro hedge?" | `2026-05-17T17-55-25-359Z_competitive-finance.json`: Claude won. OC 2, Claude 4, Codex 3, Gemini 3. | `2026-05-17T19-57-14-193Z_competitive-finance.json`: OpenCandle won. OC 5, Claude 3, Codex 2, Gemini 3. | OC had current data but treated the prompt like a generic asset comparison. Generic agents framed GLD as a steadier macro hedge and BTC as a volatile debasement/asymmetric-upside sleeve. | Added month horizon and `macro_hedge` intent extraction/enrichment, macro-hedge compare prompt guidance, scenario-map guidance, and crypto-history risk metrics. | Consider a macro-regime tool, broader sentiment coverage, and clearer portfolio-risk framing for "what are you hedging?" prompts. |
