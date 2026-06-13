# TUI harness dogfood — durable market-state chat integration

Date: 2026-06-12. Branch: `feat/persist-user-market-state`. Model: gemini-2.5-flash (google) via `tests/harness` IPC CLI. GUI server running concurrently against the same `~/.opencandle` (expected; no writer-lock interference observed).

## Setup finding (HARNESS-001, high): stock harness CLI cannot see or mutate the real `~/.opencandle`

`tests/harness/cli.ts` (`cmdRun`, lines 68–69) unconditionally does
`process.env.OPENCANDLE_HOME = mkdtempSync(join(tmpdir(), "oc-harness-home-"))` and `rmSync`s that dir on exit. There is no env passthrough or flag.

- First P1 attempt with the documented CLI "succeeded" (tool reported `Added PLTR to watchlist`, fresh-DB ids `watchlistId:1, instrumentId:1`) but the real seeded DB was untouched — the write went to a throwaway temp home that was deleted on exit.
- Consequence: the AGENTS.md-documented manual-harness flow can never exercise the seeded durable-state features on this branch (no Saved Market State from the user's real DB, no persistent writes). `runOpenCandleSession()` does accept `options.openCandleHome`, but the CLI does not expose it.
- Workaround used for this experiment: `dogfood-output/cli-real-home.ts`, a copy of `cmdRun` that sets `OPENCANDLE_HOME=~/.opencandle` and (critically) removes the `rmSync` cleanup — the stock cleanup would have deleted the user's real state if naively redirected. `wait`/`answer`/`trace` reused from the stock CLI (ipc-dir only).
- Suggested fix: respect a pre-set `OPENCANDLE_HOME` or add `--home <dir>` to `cli.ts run`, and only `rmSync` homes the harness itself created.

## Baseline DB snapshot (before P1)

watchlist_items 5, portfolio_lots 7, alert_rules 4, alert_events 0, prediction_records 3, report_runs 1.
(Note: seeding produced 5 watchlist rows — NVDA, AAPL, ASTS, SPY, MSFT — not the 6 stated in the experiment brief.)

No run asked an `ask_user` question (`interactions: 0` across all 7), so no real-time answers were needed.

---

## P1 — WRITE: "Add PLTR to my watchlist with a $35 target and thesis 'gov AI contracts ramp'." — PASS

- Duration: 3.5s (temp-home attempt: 3.7s). Tools: `manage_watchlist` (`action:add, symbol:PLTR, target_price:35, thesis:...`).
- customEntries: `opencandle-fallback-context` (`mode:rules, classifiedWorkflow:watchlist_or_tracking, symbols:["PLTR"]`), `opencandle-disclaimer`.
- Final answer: "PLTR has been added to your watchlist with a target of $35 and the thesis \"gov AI contracts ramp\"."
- DB diff: watchlist_items 5 → 6; row verified: `{symbol:"PLTR", target_price:35, thesis:"gov AI contracts ramp"}`.
- PASS: row exists with exact target and thesis.
- Qualitative: answer says "I'll notify you if it hits that level" (first temp-home run) — a watchlist target is not an alert; mildly over-promising notification behavior.

## P2 — READ: "What's in my portfolio right now and how is it doing?" — PASS

- Duration: 4.7s. Tools: `track_portfolio {action:"view"}` (live quotes via tool, not just injected context).
- customEntries: `opencandle-fallback-context`, `opencandle-disclaimer`.
- Final answer (excerpt): "Portfolio Value: $126,788.35 / Total P&L: $49,153.85 (+63.31%)" with a 7-row table: AAPL 50 @ $168.40, AAPL 25 @ $231.10, NVDA 80 @ $117.80, TSLA 30 @ $342.50, SPY 60 @ $512.30, ASTS 200 @ $51.20, RKLB 150 @ $18.40 — all quantities/cost bases exactly match the DB lots; live prices and P&L per lot.
- DB diff: none (read-only), correct.
- PASS: all saved lots with quantities, cost basis, and live P&L.
- Qualitative: literal `<br/>` tag rendered in the markdown answer; both AAPL tax lots shown separately (good — matches the lot-id fixes in the changelog).

## P3 — BRIDGE: "How would a major semiconductor export ban to China affect me?" — PASS

- Duration: 23.4s. Tools: `track_portfolio` → `search_web` (news) → `get_stock_quote NVDA` → `get_company_overview NVDA`.
- customEntries: `opencandle-fallback-context` (`classifiedWorkflow:general_finance_qa, symbols:[]`), `opencandle-disclaimer`.
- Final answer: full analyst structure (Analyst View / Commitment / Reasoning Chain / Confidence Band / Invalidation Level) ending with the required positions section:
  > **Your positions:** You currently hold 80 shares of NVDA at an average cost of $117.80. The current price of $205.19 represents a significant gain of +74.19%. Given the current geopolitical climate, while the long-term AI thesis for NVDA remains strong, it is prudent to be aware of the potential near-term headwinds and increased volatility for your position.
- DB diff: none.
- PASS: positions-impact section names NVDA with the exact saved 80 @ $117.80; fallback-context entry present.
- Qualitative: it pulled positions via `track_portfolio` itself (good agency); it did not mention watchlist-side semis exposure (NVDA watchlist thesis/target $220 unreferenced), and `symbols:[]` in the fallback entry shows the bridge came from the tool call rather than router symbol extraction. Risk framing present and concrete.

## P4 — ALERTS: "Alert me if NVDA drops below $180, and check it now." — PASS

- Duration: 3.8s. Tools: single `manage_alerts {action:"create_price_below", symbol:"NVDA", threshold:180, check_after_create:true}` — combined create+check handled in one call (matches the changelog's combined-alert-prompt fix).
- customEntries: `opencandle-fallback-context`, `opencandle-disclaimer`.
- Final answer: "An alert has been set for NVDA ... The alert was checked immediately after creation. **Manual Alert Check** - 4 rule(s): NVDA: checked / ASTS: checked / TSLA: checked / NVDA: seeded".
- DB diff: alert_rules 4 → 5. New row id 5: `price_crosses_below`, threshold 180, NVDA, enabled, `last_checked_at` set, `last_observed_json` price 205.19 (tradingview, delayed-data caveat recorded), `last_condition_state:"false"`. alert_events stayed 0 — correct, condition is false at $205.19, so no trigger event.
- PASS: new rule + immediate check executed and reported.
- Qualitative: the checked-now report is opaque — "NVDA: checked" / "NVDA: seeded" gives no current price vs threshold; a user can't tell from the answer that NVDA is at $205.19, $25 above the trigger. The raw observation (with delay caveat) is only in the DB/details.

## P5 — PREDICT: "Record a prediction: AMD bullish to $250 in 60 days, entry at current price, conviction 0.7. Then score my open predictions." — PASS (with 2 defects)

- Duration: 8.8s. Tools: `get_stock_quote AMD` ($511.57) → `track_prediction {action:record, conviction:7, ...}` → `track_prediction {action:check}`.
- customEntries: `opencandle-fallback-context`, `opencandle-disclaimer`.
- Final answer: recorded AMD bullish to $250, entry $511.57, "conviction 7/10", expires 2026-08-11; flagged the bullish-direction/target-below-entry discrepancy ("Please ensure this aligns with your intended view"); scorecard table for NVDA/TSLA/ASTS/AMD, all open, hit rate 0% (0/0).
- DB diff: prediction_records 3 → 4. Row id 4: AMD, bullish, conviction **7**, entry 511.57, target 250, expires 2026-08-11.
- PASS on the literal criteria: AMD row exists and the scoring step ran. But:
  - **DEFECT (conviction scale):** user said 0.7; agent reinterpreted as "7/10" and the tool stored `7` while all seeded rows use a 0–1 scale (0.8/0.6/0.7). No tool-side normalization/validation; weighted hit-rate math will now be dominated 10x by this row.
  - **DEFECT (target-hit not resolved):** ASTS bullish target $80, current $82.41 (+66.5%) — past target, but the check left it `open`, `correct:false`, and the answer never reported the target as hit. Scoring appears to resolve only at expiry; the experiment expectation "ASTS target-hit should resolve or be reported" was not met.
  - Minor: agent noticed the bearish-shaped "bullish to $250 from $511" prediction but recorded it anyway instead of asking for confirmation first (`ask_user` never fired).

## P6 — ACRONYM: "What did the FED and CPI data mean for my watchlist this week?" — PASS

- Duration: 18.7s. Tools: `get_economic_data CPIAUCSL`, `get_economic_data FEDFUNDS`, then `get_stock_quote` for MSFT, PLTR, ASTS, AAPL, NVDA, SPY.
- customEntries: `opencandle-symbol-dropped` ×2 — `{token:"FED", reason:"no positive ticker signal"}` and `{token:"CPI", ...}` — plus `opencandle-fallback-context` (`watchlist_or_tracking, symbols:[]`), `opencandle-disclaimer`.
- Final answer: CPI 4.17% YoY + Fed Funds 3.63% framing, then a table covering exactly the 6 real watchlist symbols (AAPL, ASTS, MSFT, NVDA, PLTR, SPY) including the saved ASTS note "High beta, watch dilution risk" and the MSFT/NVDA theses.
- DB diff: none.
- PASS: FED/CPI explicitly dropped as tickers (observability entries present), answer is grounded in the actual watchlist.
- Qualitative: "this week" answered with single-day changes only (no weekly window); FRED data stamped May 1, 2026 (monthly series) presented as "this week"'s data without a staleness caveat.

## P7 — CONTROL: "Write a haiku about autumn." — PASS

- Duration: 0.9s. Tools: none. Final answer: a clean autumn haiku, zero tickers/dollar amounts/holdings data.
- customEntries: `opencandle-disclaimer` only — **no** `opencandle-fallback-context`, confirming the finance-signal gate excludes non-finance prompts and no Saved Market State leaked.
- DB diff: none.
- PASS.
- Qualitative: the financial-advice disclaimer entry is still appended on a pure poetry turn — harmless but noisy.

---

## Final DB state (after P7)

watchlist_items 6 (+1 PLTR), portfolio_lots 7 (=), alert_rules 5 (+1 NVDA<180), alert_events 0 (=, correct), prediction_records 4 (+1 AMD), report_runs 1 (=).

## Summary table

| Run | Verdict | Key evidence |
|-----|---------|--------------|
| P1 WRITE | PASS | PLTR row, target 35, thesis exact (after home-dir workaround) |
| P2 READ | PASS | All 7 lots, exact qty/cost vs DB, live P&L via track_portfolio |
| P3 BRIDGE | PASS | "Your positions" section: NVDA 80 @ $117.80; fallback-context entry |
| P4 ALERTS | PASS | Rule id 5 (below 180), immediate check, condition false at $205.19 |
| P5 PREDICT | PASS* | AMD row + scoring ran; *conviction stored 7 not 0.7; ASTS past-target stays open |
| P6 ACRONYM | PASS | FED+CPI symbol-dropped entries; answer covers real watchlist |
| P7 CONTROL | PASS | No state leakage; no fallback-context entry |

## Issues worth fixing (priority order)

1. **HARNESS-001 (high):** documented harness CLI silently sandboxes `OPENCANDLE_HOME`; durable-state features cannot be manually harness-tested as documented, and a naive redirect would `rmSync` the user's real state dir.
2. **PREDICT conviction scale (medium):** `track_prediction` accepts conviction `7` alongside 0–1 rows; no normalization or range validation, skews weighted hit rate.
3. **PREDICT target-hit resolution (medium):** `track_prediction check` does not resolve or even flag predictions whose target has been reached pre-expiry (ASTS $82.41 vs $80 target).
4. **ALERT check readability (low):** manual check output ("NVDA: checked", "NVDA: seeded") omits observed price vs threshold; delayed-data caveat never surfaces to the user.
5. **Cosmetics (low):** literal `<br/>` in P2 markdown; disclaimer entry on non-finance turns; "this week" answered with day-change data without caveat.
