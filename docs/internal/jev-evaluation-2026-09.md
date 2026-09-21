# Jev Evaluation, 2026-09-20

**Status: paused 2026-09-20.** The spike answered the question it was built for (is Jev a routing-hot-path replacement) with a clear no, and the follow-on ideas below are worth pursuing but not urgent enough to staff immediately. The spike folder and its API traffic are being torn down; this note plus the appendix is what should survive.

## What Jev is

Jev is TypeSafe AI's "System One" model, launched 2026-09-15. It answers typed questions about a block of text (`state`) instead of generating text.

| | |
|---|---|
| Primitives | Noul (yes/no probability), Choice (one of N with a distribution and confidence), Score (2-10 ordered levels) |
| Batching | Up to 32 questions per request, evaluated in parallel against one `state` |
| Context | 32k tokens for `state` plus the longest question; 64k tokens total per request |
| Input | Text only: string, JSON object, or array of text values |
| Price | $0.042 per million input tokens; output tokens are free |
| Latency / throughput | 70-500 ms per request; 1,200 requests/min rate limit |
| Access | Proprietary API only; JS SDK `@typesafe-ai/sdk`; key env `TYPESAFE_API_KEY` |
| Known limits | Cannot extract entities or numbers, unreliable at arithmetic and dates, gives no rationale for an answer |
| Accuracy evidence | Vendor-published only: 67.8% agreement on four vendor workflows, tied with a mid-tier LLM and below frontier models, with labels derived from frontier models. No independent calibration curves exist as of 2026-09. |

## Spike method

89 labeled prompts from data already in this repo: 32 router fixtures (`tests/fixtures/router/`), routing/product eval cases, and planning unit-test pairs. No live sessions or `~/.opencandle` data were used. 257 Jev requests total across six experiments (E1 route/workflow/task-family classification, E2 tool-family selection, E3 clarification gating, E4 effort scoring, E5 latency/cost, E6 sensitivity to option descriptions and re-run determinism), plus a control measuring the existing regex entity extractor.

| Experiment | What it measured | Result |
|---|---|---|
| E1: route/workflow/task-family (Choice, with descriptions) | Accuracy against the 32 router fixtures | routeKind 25/32, workflow 25/32, task family 27/31 |
| E1: calibration | Accuracy split by Jev's own confidence | 16/16 correct above 0.7 confidence, 9/16 below |
| E6: terse labels (no descriptions) | Same 32 fixtures, Choice options with no description text | routeKind accuracy collapsed from 0.78 to 0.22; workflow accuracy fell less, from 0.78 to 0.69 |
| E6: determinism | Re-ran 20 already-scored E1 prompts a second time | routeKind changed on 3/20, workflow on 4/20, task family on 3/20; confidence itself moved by 0.05-0.12 on average |
| E2: tool-family Nouls (threshold 0.8) | Precision/recall per tool family against required-tool ground truth, n=22 | recall 1.0 on every family; precision 1.0 on options/sec/sentiment, 0.5 on macro, 0.4 on fundamentals, 1.0 on history/technicals (recall there drops to 0.5 at this threshold) |
| E3: clarification gate ("must ask" Noul, threshold 0.7) | False-ask / false-guess rate, n=36 | 24/36 false asks, 0 false guesses, 12/36 overall correct |
| E4: effort Score (4-level rubric) | Mean Jev score by proxy effort level, n=54 | level 1: 1.08, level 2: 1.40, level 3: 1.37, level 4: 2.52, separating trivial from deep, does not separate the middle two levels |
| E5: latency/cost | p50/p95 latency and token cost over 30 calls of the two request shapes actually used | p50 174 ms, p95 339 ms; ~$0.035 per 1,000 turns at these token counts. Production LLM router: p50 approx 2.0-2.2s/call from recorded router-live eval runs |
| Hybrid coverage (control, not Jev) | How often the existing deterministic regex extractor alone reproduces gold symbols + budget | 25/32 fixtures (23 fixtures have no prior-turn dependence; 20/23 of those match) |

The single most reusable finding is not a number: it's that Choice accuracy on `routeKind` depends almost entirely on writing a real description for every option. Bare labels are close to useless (0.22 accuracy, barely above the 4-way random baseline); the same labels with one sentence each recover 0.78. `workflow` degraded much less (0.78 → 0.69), probably because workflow names like `portfolio_builder` are already self-describing. The exact wording that got 0.78 is in the appendix.

## Decisions

**Not in the routing hot path.** Jev cannot extract entities (dates, dollar amounts, ticker symbols), which the router needs on every turn. A hybrid (Jev for coarse classification, the existing regex extractor for slots, LLM fallback when the regex extractor is unsure) could plausibly skip the LLM router call on an estimated 35-45% of turns and save about 1.8s of latency on those. But that estimate rests on N=16 (the above-0.7-confidence bucket in E1), it makes the regex extractor load-bearing for production routing rather than a best-effort fallback, and it adds a single-vendor dependency plus a new third party that receives raw turn text. Not worth it at this evidence level. The production LLM router scores 32/32 on the same fixture set Jev scored 25/32 on, so there's no accuracy case for switching, only a latency/cost one, and only for a fraction of turns.

**Not for**: the planning task-family classifier, tool-family hints, the clarification ("should I ask the user") gate, or thinking-level (effort) routing. Task-family and tool-family Choice/Noul results are directionally fine but add a network call for a decision the deterministic router manifest already makes for free. The clarification gate is not usable as worded: a 67% false-ask rate would make the agent needlessly interrupt two-thirds of turns that didn't need it. Effort Score only cleanly separates "trivial" from "deep"; it can't be trusted to pick between "single tool" and "multi-tool analysis," which is exactly the distinction that would matter for a thinking-level router.

## Where it could fit if resumed, in priority order

1. **Live-tier eval assertions in shadow mode.** Several eval scorers are hand-rolled keyword/regex checks standing in for semantic judgment: the family-aware regexes in `tests/evals/product/scorer.ts`, `tests/evals/scorers/risk-disclosure.ts`, and the 14 regex-mapped hard assertions in `tests/evals/prompt-policy-assertions.ts`. Replace these with Noul assertions in the live eval tier only, never the offline unit gate; keep the regex checks for anything structural or numeric (those are exactly what Jev is bad at), and log both scorers' verdicts side by side for a few weeks before switching any assertion over.
2. **Sentiment scoring.** `src/sentiment/scorer.ts` is currently a 31-term keyword matcher. A Score primitive (bearish-to-bullish) plus Nouls for sarcasm and "does this post treat the ticker as an investment", batched up to 32 posts per request, would be a reasonable optional api-key provider with the keyword scorer kept as the no-key fallback. Bounded Noul/Score outputs are a safe way to let untrusted social text influence a number without letting the text itself reach a prompt. Sentiment is local-only today, so this would not touch the hosted relay.
3. **Second cheap judge in the competitive benchmark**, to flag disagreement with the existing LLM judge, and a Choice for mapping improvement suggestions onto the durable-layer taxonomy (routing/planning, slot extraction, tool capability, evidence normalization, policy card, workflow prompt, answer contract, structured check, eval assertion, harness) that AGENTS.md already asks contributors to classify into by hand.

Revisit the routing hybrid specifically only if the above-0.7 calibration pattern (16/16 correct) holds over a few hundred eval prompts instead of 16.

## Integration costs to remember

- A new provider is ask-first per AGENTS.md's boundaries section; this was a spike, not an integration decision.
- Any real integration needs graceful behavior with no key configured (matches how every other optional provider in `src/providers/` behaves).
- `docs/how-the-web-app-works.md` documents every third party in the data path; adding Jev anywhere reachable from the web app means adding it there.
- The hosted relay's allowlist would need `api.typesafe.ai` added if any Jev-backed feature were ever exposed through the browser runtime; nothing here proposes that.

## Appendix: reusable spike assets

### The Choice descriptions that got 0.78 accuracy (routeKind)

Question text: *"For OpenCandle (a finance research agent), which route kind should this user turn take?"*

```
workflow_dispatch: "Turn clearly matches a structured, dispatchable workflow
  (portfolio construction, options screening, or asset comparison) AND all
  required details are already known"
agent_task: "In-scope finance work the main analyst agent should answer
  directly: data lookups, single-asset analysis, watchlist/tracking
  questions, or general finance Q&A"
clarification: "A required detail is missing (e.g. options workflow needs a
  ticker, portfolio needs a budget) and the agent must ask the user before
  proceeding"
pass_through: "The request is outside OpenCandle's finance task surface
  entirely (not about markets/investing)"
```

Dropping these four sentences to bare labels (`workflow_dispatch`, `agent_task`, `clarification`, `pass_through` with no description) is what collapsed accuracy to 0.22 (E6). The `workflow` question used a matching one-line description per workflow label (`portfolio_builder`, `options_screener`, `compare_assets`, `single_asset_analysis`, `watchlist_or_tracking`, `general_finance_qa`, `none`) and lost far less by comparison; see `task-family-descriptions.ts` in the (now-deleted) spike for the full set of task-family, route-kind, and workflow description strings if this is picked back up.

### The Noul questions used for tool-family gating (E2)

One question per tool family, batched in a single request against `state: { userRequest: <prompt> }`:

```
options:            "Does answering this request require fetching options chain
                      data (calls/puts, strikes, expirations)?"
sec:                 "Does answering this request require fetching SEC filings
                      (10-K, 10-Q, 8-K)?"
macro:               "Does answering this request require macro/economic series
                      data (interest rates, CPI, GDP, Fear & Greed index, event
                      probabilities)?"
sentiment:           "Does answering this request require social or news
                      sentiment data (Reddit, Twitter/X, or news mood)?"
fundamentals:        "Does answering this request require company fundamentals
                      or financial statements (overview, earnings, DCF,
                      statement comparison)?"
saved_state:         "Does answering this request require reading or changing
                      the user's saved portfolio, watchlist, or alerts?"
history_technicals:  "Does answering this request require price history or
                      technical indicators (historical prices, moving
                      averages, backtests, correlation)?"
```

### The clarification-gate Noul that was NOT usable as worded (E3)

*"A required detail is missing such that a careful financial analyst must ask a clarifying question before proceeding, rather than guessing or proceeding with an assumption."*

This produced 0 false guesses but 24/36 false asks at threshold 0.7; it reads as "could more detail help" rather than "is a detail missing that blocks a reasonable default," and needs re-scoping (probably per-workflow required-slot questions instead of one global question) before it's usable.

### Minimal SDK call shape

```typescript
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { choice, noul, score } from "@typesafe-ai/sdk";

const client = new TypeSafeClient(); // reads TYPESAFE_API_KEY from env

const { answers } = await client.systemOne({
  state: { currentTurn: "Build me a balanced $50k portfolio" },
  questions: {
    routeKind: choice(
      "For OpenCandle (a finance research agent), which route kind should this user turn take?",
      { workflow_dispatch: "...", agent_task: "...", clarification: "...", pass_through: "..." },
    ),
    macro: noul("Does answering this request require macro/economic series data?"),
    effort: score("How much analytical depth/effort does answering this request need?", [
      "Quick lookup: a single fact or number",
      "Single tool + short answer",
      "Multi-tool analysis: several data sources combined",
      "Deep multi-step research: multi-asset or multi-analyst",
    ]),
  },
});

answers.routeKind.choice;      // e.g. "workflow_dispatch"
answers.routeKind.confidence;  // 0-1
answers.macro.noul;            // 0-1 probability
answers.effort.score;          // 0-3 (indexed from the rubric array)
```

### How to rerun

The spike scripts are being deleted with this note; the harness logic to rebuild them:

1. Load 32 fixtures from `tests/fixtures/router/*.json` (skip `BASELINE.json`), each carrying `input`, optional `priorTurns`, and `expectedRouterOutput` (routeKind, workflow, entities.symbols, entities.budget, missing_required).
2. Build `state` as `{ currentTurn: fixture.input }`, or `{ priorTurns: [...], currentTurn }` when prior turns exist, formatting each prior turn as `` `[${role}] ${text}` ``.
3. Send one `systemOne` request per fixture with the three Choice questions above (or the Noul/Score questions for the other experiments), track latency and `usage.input_tokens`/`usage.output_tokens` per call, and cap total requests (the spike capped at 2,000) so a bug can't runaway-spend.
4. Score by exact match against `expectedRouterOutput` fields; bucket by the returned `confidence` for calibration; compute mean score by an independently-labeled effort proxy for the Score experiment.
5. For the hybrid-coverage control, call the existing `extractEntities` from `src/routing/entity-extractor.ts` directly (no Jev call) and compare its `symbols`/`budget` output against the same fixture's expected values.

Everything above ran through `tsx` against plain `.ts` files with no build step; `@typesafe-ai/sdk` was pinned at `^0.6.0`.

## Sources

- https://docs.typesafe.ai/models
- https://flaviocopes.com/jev/
- https://www.langchain.com/blog/building-a-harness-with-jev
- https://www.latent.space/p/ainews-jev-a-system-one-model-that
- https://www.datacamp.com/blog/system-one-models-jev
- https://anthonymaio.substack.com/p/jev-the-language-model-that-wont
- https://dev.to/valyuai/how-to-use-jev-a-practical-guide-to-typesafes-system-one-model-g5e
