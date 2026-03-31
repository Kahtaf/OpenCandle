# OpenCandle Real-Usage E2E Fix Handoff

**Date:** 2026-03-29  
**Status:** Implementation handoff for the next agent  
**Audience:** Engineer / agent taking over runtime-quality fixes after workflow routing and memory landed  
**Scope:** Fix the remaining issues discovered by running the real CLI agent against broad, realistic user prompts

---

## 1. Why This Doc Exists

The recent routing, follow-up, and memory work materially improved OpenCandle:

- broad portfolio prompts now trigger portfolio construction instead of generic refusal
- broad options prompts now trigger options screening instead of asking for an exact expiry and stopping
- preferences persist across sessions
- missing-slot prompts can trigger compact clarification

However, when the real agent was exercised end to end through the CLI, several runtime issues still surfaced. These are not mostly unit-test failures. They are workflow-control, prompt-quality, parsing, and ranking issues that only become obvious under live usage.

This doc is a handoff for fixing those issues without repeating the whole investigation.

This is not a speculative audit. The findings below come from actual CLI runs on **March 29, 2026** in the local repo.

---

## 2. What Was Actually Tested

The real CLI agent was run with `npm start` in multiple fresh sessions. Prompts used:

1. `If I had $10k to invest today, what should I invest in?`
2. `Give me the best MSFT call options that are a month out.`
3. `I'm conservative and prefer ETFs only. If I had $10k to invest today, what should I invest in?`
4. `If I had $20k to invest today, what should I invest in?` in a new session after saving preferences
5. `What should I invest in?`
6. Clarification answer: `$15k and I'm aggressive`
7. `Give me the best MSFT call options that are a month out, under $500 premium, and liquid.`

Observed tool calls included:

- `get_stock_quote`
- `get_company_overview`
- `analyze_risk`
- `analyze_correlation`
- `get_option_chain`

Key runtime outcomes:

- the broad prompts now route correctly
- memory is actually being reused across sessions
- several real UX / control-flow bugs remain

---

## 3. Executive Summary Of Remaining Problems

### Highest-severity fixes

1. **Queued workflow follow-ups can leak into later turns**
   - The agent can continue running synthetic follow-up prompts after it has already returned control to the user.
   - This can interleave output from an older workflow with a newer user request.

2. **Clarification budget parsing is wrong**
   - `$15k and I'm aggressive` was parsed as **$15**, not **$15,000**.

3. **Options date handling is not grounded**
   - The model referenced different current dates across runs and even invented one to make expiration selection fit.
   - This directly harms DTE filtering and options ranking quality.

### Medium-severity fixes

4. **Assumption source labeling is inaccurate**
   - Stored preferences are sometimes labeled as user-specified.
   - Same-turn explicit values and remembered values are not cleanly separated.

5. **ETF workflows still call stock-fundamental tools**
   - `get_company_overview` is predictably failing on ETFs and adding noise, latency, and confusing narrative.

6. **Options ranking logic is too weak**
   - The workflow can rank ultra-cheap, near-zero-delta calls as the “best” contracts because they pass filters.

7. **Portfolio outputs can become unusably verbose**
   - Some runs produced bloated multi-screen responses with poor signal density.

---

## 4. Detailed Findings

## 4.1 Follow-Up Queue Leakage Across Turns

### What happened

In one live session:

1. the user asked for a `$10k` portfolio
2. the agent ran the portfolio workflow
3. the user then asked for MSFT call options
4. after answering the options prompt, the agent resumed and emitted old portfolio follow-up output without a new user turn

The leaked output included:

- a portfolio correlation review
- a second portfolio summary
- additional disclaimer text

This is a control-flow failure, not just verbose output.

### Why this matters

This breaks trust quickly:

- users can no longer tell which answer belongs to which prompt
- stored workflow summaries become less reliable
- memory may capture mixed-turn output
- later automation or UI integration will become brittle

### Likely root cause

The follow-up mechanism appears to enqueue synthetic user messages immediately after the initial workflow prompt:

- [src/index.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/index.ts#L159)
- [src/index.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/index.ts#L242)
- [src/index.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/index.ts#L271)

The likely issue is:

- `agent.followUp(...)` is fire-and-forget
- there is no workflow run state machine
- there is no cancellation when a new top-level user turn arrives
- there is no guarantee that follow-up messages complete before `promptUser()` returns control

### Probable implementation direction

Do not patch this with prompt wording. Fix the control flow.

Recommended approach:

1. Introduce an explicit workflow execution state.
   - Example states:
     - `idle`
     - `running_initial_prompt`
     - `running_followup`
     - `awaiting_user`

2. Associate each workflow run with a `runId`.
   - Every queued follow-up should carry the originating `runId`.

3. Refuse to execute stale follow-ups.
   - If a new user turn starts and `runId` changes, any pending follow-up for the old run should be dropped.

4. Decide whether follow-ups should be:
   - internal orchestration steps invisible to the user, or
   - separate agent turns serialized before returning the prompt

Do not keep the current hybrid model where the user prompt returns before internal follow-ups are guaranteed to be complete.

### Files to inspect

- [src/index.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/index.ts)
- possibly agent event ordering assumptions in [src/agent.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/agent.ts)

### Acceptance criteria

1. Run `If I had $10k to invest today, what should I invest in?`
2. Before the portfolio workflow is fully complete, send `Give me the best MSFT call options that are a month out.`
3. Verify:
   - no old portfolio text appears after the options answer starts
   - only one workflow owns the output stream at a time
   - workflow summaries in memory are attached to the correct run only

---

## 4.2 Budget Clarification Parsing Bug

### What happened

For the prompt:

- `What should I invest in?`

the agent asked:

- `What budget are you working with? (e.g., $10k, $50,000)`

I answered:

- `$15k and I'm aggressive`

The resulting assumptions said:

- `Budget: $15`
- `Risk profile: aggressive`

So risk extraction worked, but budget parsing did not.

### Why this matters

This is a real-user failure mode, not an edge case. Users routinely respond to follow-ups with mixed natural language:

- `$10k, balanced`
- `around 25k and conservative`
- `5k max and ETFs only`

If the parser mishandles these, the workflow becomes misleading while still looking polished.

### Likely root cause

The current parsing path in [src/index.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/index.ts#L219) is too naive:

- it strips symbols
- then uses `parseFloat`
- then only handles a trailing `k`

That fails for strings where `k` is not the final character after cleanup.

### Probable implementation direction

Move budget parsing into a dedicated utility, not inline CLI logic.

Requirements for the parser:

- support:
  - `$10k`
  - `10k`
  - `$10,000`
  - `10000`
  - `around 15k and aggressive`
  - `budget is 25k max`
  - `under $500 premium`
- parse the first money expression relevant to the slot
- distinguish budget from unrelated numbers if possible

Suggested implementation:

1. Add `parseMoneyExpression(input: string): number | undefined`
2. Use targeted regex patterns before fallback numeric parsing
3. Add unit tests for mixed natural-language clarification responses

### Files to inspect

- [src/index.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/index.ts)
- potentially [src/routing/entity-extractor.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/routing/entity-extractor.ts) if you want shared money parsing between first-turn extraction and clarification parsing

### Acceptance criteria

The clarification response:

- `$15k and I'm aggressive`

must yield:

- `budget = 15000`
- `riskProfile = aggressive`

Add tests for at least 8 mixed-language money inputs.

---

## 4.3 Options Workflow Date Grounding Is Unreliable

### What happened

In live runs on **March 29, 2026**:

- one answer referenced **March 28, 2026**
- another answer invented **February 15, 2026** as “current date for tool context”

That second run used the fabricated date to justify expirations matching the requested 25-45 DTE band.

### Why this matters

This is a correctness issue. The workflow is explicitly about:

- DTE bands
- expiration selection
- ranking near-term options

If the date anchor drifts, the workflow can:

- select the wrong expirations
- rank contracts that do not satisfy user intent
- present fabricated reasoning that looks authoritative

### Likely root cause

The workflow prompt appears to rely on the model to infer “today” instead of injecting the actual date from runtime.

Likely contributing factors:

- current date is not passed as a structured slot
- prompt wording gives the model room to improvise
- the agent may be trying to reconcile tool output with prompt intent by inventing date context

### Probable implementation direction

Do not let the model guess “today.”

Recommended fix:

1. Inject the actual runtime date into workflow prompts.
   - For example: `Current date: 2026-03-29`

2. If possible, compute target expiration windows outside the model.
   - Given `dteTarget = 25_to_45_days`
   - derive:
     - `windowStart`
     - `windowEnd`

3. If the tool only returns available expirations, perform deterministic expiration selection in code.
   - Choose expirations in the requested window before asking the model to rank contracts.

4. Forbid date invention in workflow prompts.
   - Tell the model to use only:
     - explicit runtime date
     - explicit tool-returned expiration dates

### Files to inspect

- [src/workflows/options-screener.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/workflows/options-screener.ts)
- [src/prompts/workflow-prompts.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/prompts/workflow-prompts.ts)
- possibly [src/routing/slot-resolver.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/routing/slot-resolver.ts)

### Acceptance criteria

On **March 29, 2026**, for:

- `Give me the best MSFT call options that are a month out.`

the answer must:

- explicitly anchor to `2026-03-29`
- not invent a different current date
- only evaluate expirations that actually fit the requested DTE window
- avoid falling back to 2 DTE contracts unless it explicitly states no matching expirations were available

---

## 4.4 Assumption Attribution Is Wrong

### What happened

In the memory tests:

- explicit preferences in the same prompt were applied correctly
- stored preferences were reused in new sessions

But the output labeling was inconsistent. Example patterns:

- remembered values labeled as “User-specified”
- same-turn extracted preferences labeled as “From preferences”
- conflicting preference override text that was technically true but hard to follow

### Why this matters

The workflow disclosure section is one of the main safety / trust features. If attribution is wrong, the answer becomes harder to interpret and the product’s “transparent assumptions” claim weakens.

### Likely root cause

The workflow has enough data to resolve slots, but not enough provenance tracking to distinguish:

- literal user input in the current top-level prompt
- current clarification input
- prior stored preference
- default

There is probably a mismatch between:

- slot source attribution
- prompt rendering logic
- current-turn merged preferences

### Probable implementation direction

Treat source attribution as first-class structured data.

Recommended model:

- `user_current_turn`
- `user_clarification_turn`
- `preference_memory`
- `default`

Then map those internal values to user-facing labels:

- User-specified
- From clarification
- From saved preferences
- Default

Do not infer this in the final prose layer from value equality alone.

### Files to inspect

- [src/routing/slot-resolver.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/routing/slot-resolver.ts)
- [src/prompts/workflow-prompts.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/prompts/workflow-prompts.ts)
- [src/index.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/index.ts)

### Acceptance criteria

For:

- `I'm conservative and prefer ETFs only. If I had $10k to invest today, what should I invest in?`

the answer should clearly show:

- budget: user-specified
- risk profile: user-specified
- asset scope: user-specified
- time horizon: default

Then in a new session with:

- `If I had $20k to invest today, what should I invest in?`

the answer should show:

- budget: user-specified
- risk profile: from saved preferences
- asset scope: from saved preferences

---

## 4.5 ETF Workflows Are Using The Wrong Tool Path

### What happened

For ETF-focused portfolios, the agent repeatedly called:

- `get_company_overview(SPY)`
- `get_company_overview(BND)`
- `get_company_overview(VIG)`
- `get_company_overview(XLP)`

These calls predictably failed, and the model then explained that ETF fundamentals are not available from that tool.

### Why this matters

This is bad UX and wasted latency:

- the failures are avoidable
- the narrative becomes apologetic
- tool calls are spent on known-bad paths
- ETF recommendations feel less trustworthy because the workflow visibly stumbles

### Likely root cause

The portfolio workflow prompt still assumes a stock-like analysis pipeline:

- quote
- overview
- risk
- correlation

That is reasonable for single equities, but wrong for ETF-focused workflows.

### Probable implementation direction

Split portfolio candidate evaluation by asset type.

If asset scope is ETF-focused:

- skip `get_company_overview`
- rely on:
  - quote
  - risk
  - correlation
  - possibly a lightweight static rationale layer in prompt logic

If mixed or stock-focused:

- keep the existing fundamental path for equities

The better long-term solution is to add ETF-aware tools, but that is not required for this fix.

### Files to inspect

- [src/workflows/portfolio-builder.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/workflows/portfolio-builder.ts)
- [src/prompts/workflow-prompts.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/prompts/workflow-prompts.ts)

### Acceptance criteria

For an ETF-focused portfolio request:

- no `get_company_overview` calls should be made for ETF tickers
- the final answer should not contain apology text about ETF overview failures
- the portfolio should still contain a concise rationale per ETF

---

## 4.6 Options Ranking Is Still Too Naive

### What happened

For:

- `Give me the best MSFT call options that are a month out, under $500 premium, and liquid.`

the workflow did use the right tool family and reflected the premium cap. But the ranked results favored contracts like:

- very cheap
- very far OTM
- near-zero delta

because they passed the liquidity and premium filters.

### Why this matters

A user asking for the “best” call options generally does not mean:

- the cheapest liquid lottery tickets

unless they explicitly asked for speculative upside at the expense of probability.

### Likely root cause

The current ranking objective in the workflow prompt is too vague:

- “balanced leverage and probability”

That still leaves the model too much room, especially when tool data is incomplete or filtered.

### Probable implementation direction

Push more ranking structure into code or into stricter prompt instructions.

At minimum:

1. Reject extremely low-delta contracts by default for the balanced objective.
   - Example default floor:
     - delta >= 0.20

2. Prefer ATM / slight OTM candidates before farther OTM candidates.

3. Score candidates using explicit weighted factors.
   - Example:
     - moneyness fit
     - delta band fit
     - DTE fit
     - open interest
     - bid-ask spread
     - premium within user cap

4. Only surface “cheap speculative contracts” when:
   - objective is explicitly aggressive/speculative, or
   - no better candidates exist

### Files to inspect

- [src/workflows/options-screener.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/workflows/options-screener.ts)
- [src/prompts/workflow-prompts.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/prompts/workflow-prompts.ts)

### Acceptance criteria

For the balanced default objective:

- top-ranked options should not have near-zero delta unless no better candidate fits the filters
- final rationale should explain why the winner balances payoff and probability, not just why it is cheap

---

## 4.7 Portfolio Output Length Needs Harder Constraints

### What happened

One ETF portfolio response became extremely long and effectively unusable. The content was not purely wrong; it was just far too verbose for a command-line financial assistant.

### Why this matters

This is a real product issue:

- the answer becomes harder to scan
- important points are buried
- token usage and latency increase
- follow-up answers can become more chaotic

### Likely root cause

The workflow prompt asks for a lot of explanatory structure, but there are no strong constraints on:

- max rationale length per position
- max number of sections
- how much to say when tool coverage is thin

### Probable implementation direction

Tighten the output contract in workflow prompts.

Recommended constraints:

- max 1 line of rationale per position
- max 3 bullets in risk summary
- max 2 bullets in “for more growth / for more safety”
- no repeated explanation of tool limitations

If needed, add post-processing truncation rules in the CLI renderer, but prompt tightening should come first.

### Files to inspect

- [src/prompts/workflow-prompts.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/prompts/workflow-prompts.ts)
- [src/workflows/portfolio-builder.ts](/Users/kahtaf/Documents/workspace_kahtaf/vantage/src/workflows/portfolio-builder.ts)

### Acceptance criteria

For the ETF-focused `$10k` conservative portfolio prompt:

- the answer should fit comfortably in a normal terminal screen progression
- rationale should stay concise
- no single section should dominate the response

---

## 5. Recommended Implementation Order

Do these in this order:

1. **Fix follow-up queue leakage**
   - This is the most dangerous control-flow problem.

2. **Fix budget clarification parsing**
   - This is a straightforward correctness bug affecting common usage.

3. **Ground options date handling**
   - This is required before trusting “month out” options answers.

4. **Fix assumption attribution**
   - Important for trust and for reviewers evaluating memory behavior.

5. **Skip stock-fundamental tools for ETF workflows**
   - Quick UX win with immediate latency reduction.

6. **Improve options ranking defaults**
   - Important for recommendation quality after date handling is fixed.

7. **Tighten output length**
   - Important, but should come after correctness and control-flow fixes.

---

## 6. Suggested Test Plan

The next agent should not stop at unit tests. Re-run real CLI sessions.

### Session A: broad portfolio

Prompt:

- `If I had $10k to invest today, what should I invest in?`

Verify:

- workflow routes correctly
- tools are called
- no refusal
- no leaked follow-up into later turns

### Session B: minimal clarification

Prompt:

- `What should I invest in?`

Clarification answer:

- `$15k and I'm aggressive`

Verify:

- budget parses to `15000`
- risk parses to `aggressive`
- attribution is correct

### Session C: memory reuse

Prompt 1:

- `I'm conservative and prefer ETFs only. If I had $10k to invest today, what should I invest in?`

New session prompt:

- `If I had $20k to invest today, what should I invest in?`

Verify:

- remembered preferences are reused
- remembered values are labeled as saved preferences, not user-specified

### Session D: month-out options

Prompt:

- `Give me the best MSFT call options that are a month out.`

Verify:

- actual runtime date is used
- selected expirations really fit 25-45 DTE
- no fabricated date context

### Session E: constrained options

Prompt:

- `Give me the best MSFT call options that are a month out, under $500 premium, and liquid.`

Verify:

- premium cap is reflected
- liquidity is reflected
- ranking does not default to absurdly low-delta lottery contracts

### Session F: ETF portfolio

Prompt:

- `I'm conservative and prefer ETFs only. If I had $10k to invest today, what should I invest in?`

Verify:

- no `get_company_overview` calls on ETFs
- concise output
- no tool-failure apology loop

---

## 7. Open Questions For The Next Agent

These do not block implementation, but the next agent should make explicit decisions.

1. Should workflow follow-ups remain synthetic user turns at all?
   - It may be cleaner to build a small internal orchestrator instead of relying on `agent.followUp`.

2. Should options expiration selection move fully out of the model?
   - I believe yes, if tool output exposes enough expiration metadata.

3. Should ETF-specific candidate lists be hardcoded defaults, config-driven, or inferred dynamically?
   - A simple config-driven shortlist is probably enough for now.

4. Should output length be enforced only by prompt, or also by renderer / post-processing?
   - Prefer prompt first, renderer only if the model still drifts.

---

## 8. Strong Recommendation

Do not treat the current implementation as “done because it no longer refuses broad prompts.”

That was the first milestone, not the finish line.

The remaining gaps are now more subtle:

- workflow state management
- correctness of parsed values
- correctness of time anchoring
- ranking quality
- output discipline

These are exactly the issues that determine whether the product feels like:

- a genuinely useful financial assistant, or
- a demo that only works on the happy path

The next agent should prioritize runtime behavior over adding more features.

