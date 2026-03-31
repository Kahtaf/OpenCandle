# OpenCandle Workflow Routing, Clarification, and Memory Design

**Date:** 2026-03-29
**Status:** Proposed implementation plan
**Audience:** The next agent or engineer implementing the feature set, plus any reviewer expected to challenge the design
**Scope:** Make OpenCandle meaningfully more useful on ambiguous real-user prompts without rewriting the existing tool layer

---

## 1. Executive Summary

OpenCandle is currently strongest when the user speaks in the product's exact internal dialect, for example:

- `analyze NVDA`
- `get the options chain for TSLA`
- `run risk analysis on SPY`

It performs much worse on realistic investor prompts, especially prompts that are:

- ambiguous
- recommendation-shaped
- multi-step
- partially specified

Examples observed in live runs:

1. `If I had $10k to invest today, what should I invest in?`
   - Result: no tools called
   - Behavior: generic refusal / disclaimer response

2. `Build me a diversified $10k starter portfolio for today's market with 4 positions.`
   - Result: no tools called
   - Behavior: generic refusal / disclaimer response

3. `Give me the best MSFT call options that are a month out.`
   - Result: no tools called
   - Behavior: asks for exact expiration and a definition of "best", then stops

4. `analyze NVDA`
   - Result: many tools called
   - Behavior: productive, though still with quality issues

The product gap is not primarily "missing more tools." It is:

- weak intent routing
- no structured follow-up policy
- no stored user preferences
- no durable conversational memory
- no workflow-specific defaults

This document proposes a thin orchestration layer above the existing tool system that adds:

1. workflow routing by user intent
2. slot-based clarification with strict limits
3. defensible defaults when the user stays vague
4. a local memory system for preferences and history
5. append-only chat logs for audit, debugging, and future retrieval
6. structured outputs and explicit assumption reporting

The plan is intentionally incremental. It avoids a full rewrite of the agent or tool stack.

---

## 2. Problem Statement

### 2.1 What is failing today

The current product assumes the base agent will either:

- infer the exact tool sequence from freeform text, or
- ask for clarification in a useful way

In practice, it often does neither.

Observed failure modes:

#### A. Broad recommendation prompts cause refusal instead of scoped help

Prompts like:

- `What should I invest in today?`
- `Build me a starter portfolio`

currently lead to:

- zero tool usage
- a generic non-personalized-advice refusal
- no effort to transform the prompt into a tractable analysis workflow

This is poor product behavior. The agent should not need to deliver personalized financial advice to still be useful. It can instead say:

- what assumptions it is making
- what a sample portfolio looks like under those assumptions
- what data supports the picks

#### B. Ambiguous prompts trigger over-blocking clarification

Prompt:

- `Give me the best MSFT call options that are a month out`

currently leads to:

- no tool usage
- a request for exact expiration
- a request to define "best"
- no partial answer

This is a bad default for an agent. The system should have:

- a default DTE band
- a default notion of "best" for options screening
- a clear assumption if the user does not narrow further

#### C. User preferences are not remembered

Even if a user repeatedly wants:

- balanced risk
- 1-year horizon
- ETF-heavy portfolios
- only liquid large-cap names

the agent has no durable preference layer. Each turn is treated as a fresh session.

#### D. The product lacks useful memory and inspection

Today:

- there is no durable conversational history layer for recommendations
- there is no stored profile for user investing preferences
- there is no structured log of why a recommendation was produced

This prevents:

- personalized defaults
- consistent follow-up sessions
- recommendation auditability
- meaningful debugging of agent failures

---

## 3. Design Goals

### Primary goals

1. Make OpenCandle useful on realistic investor prompts without requiring the user to speak in internal tool names.
2. Ask fewer but better follow-up questions.
3. Persist enough memory to improve future turns.
4. Keep the system inspectable and debuggable.
5. Preserve the existing tool layer as much as possible.

### Secondary goals

1. Make the recommendation process auditable.
2. Make it easy to add more workflows later.
3. Avoid introducing a fully general "agent memory" system before the simpler cases are working.

### Non-goals

1. This design does not attempt to solve full financial planning.
2. This design does not propose autonomous trading.
3. This design does not require replacing Pi-mono or the existing tool registry.
4. This design does not depend on vector embeddings or semantic memory in v1.

---

## 4. Design Principles

These principles are derived from a mix of financial-agent patterns and broader agent UX patterns.

### Principle 1: Route by workflow, not only by freeform prompt

The base agent is too unstructured to reliably infer the correct behavior for recommendation-shaped prompts.

Therefore:

- detect intent up front
- route into a workflow
- then let the base agent and tools operate within that narrower frame

### Principle 2: Ask only for missing variables that materially change the answer

The system should avoid long clarification trees. It should:

- ask 1-3 questions at most
- only ask when the answer changes the ranking, allocation, or risk profile
- otherwise proceed with assumptions

### Principle 3: Defaults are better than dead ends

If a user says:

- `best MSFT calls a month out`

the system should produce:

- a reasonable DTE assumption
- a default ranking objective
- a transparent explanation of those assumptions

instead of becoming unusable.

### Principle 4: Memory should improve future turns, not flood model context

Raw chat logs are valuable for audit and debugging, but should not be dumped wholesale into prompts.

The system should store:

- full local chat logs
- extracted structured preferences
- short summaries for retrieval

Prompt injection should use:

- compact profile data
- small recent memory snippets
- workflow-specific summaries

### Principle 5: Separate analysis from decision

For recommendation-shaped prompts, the system should perform:

1. candidate generation
2. evidence gathering
3. risk / diversification filtering
4. final presentation

instead of trying to produce the final answer in one unstructured jump.

---

## 5. Proposed Features

### 5.1 Workflow router

Add a routing layer that classifies incoming prompts before sending them to the agent loop.

#### Initial workflow types

1. `single_asset_analysis`
   - examples:
     - `analyze NVDA`
     - `is AAPL attractive here?`

2. `portfolio_builder`
   - examples:
     - `I have $10k to invest`
     - `build me a diversified starter portfolio`

3. `options_screener`
   - examples:
     - `best MSFT calls a month out`
     - `show me safer TSLA puts for next month`

4. `compare_assets`
   - examples:
     - `compare AAPL, MSFT, GOOGL`
     - `which is better, SPY or QQQ?`

5. `watchlist_or_tracking`
   - examples:
     - `add NVDA to my watchlist`
     - `how are my predictions doing?`

6. `general_finance_qa`
   - examples:
     - `what is the fed funds rate?`
     - `what does delta mean?`

#### Why a router is necessary

Without a router, the current system relies too heavily on prompt wording. That is why:

- `analyze NVDA` works
- `what should I buy with $10k?` fails

This design fixes that mismatch.

---

### 5.2 Slot-based clarification

Each workflow gets a compact set of slots. The system fills them in this order:

1. explicit user input
2. remembered user preferences
3. workflow defaults
4. targeted follow-up question if still necessary

#### Portfolio builder slots

Required to proceed:

- `budget`

Strongly preferred but can default:

- `risk_profile`
- `time_horizon`
- `asset_scope`
- `position_count`

Optional:

- `exclude_sectors`
- `income_vs_growth`
- `account_type`
- `max_single_position_pct`

#### Options screener slots

Required to proceed:

- `symbol`

Strongly preferred but can default:

- `direction`
- `dte_target`
- `objective`
- `budget`
- `moneyness_preference`

Optional:

- `max_premium`
- `liquidity_minimum`
- `iv_preference`

#### Clarification policy

The system may ask follow-up questions only if:

- a required slot is missing, or
- a missing slot changes ranking significantly and no good default exists

Hard cap:

- maximum 2 follow-up turns before proceeding with explicit assumptions

This cap matters. Without it, the agent becomes a questionnaire instead of a useful assistant.

---

### 5.3 Workflow defaults

Defaults should be conservative, transparent, and easy to override.

#### Portfolio builder defaults

- `risk_profile = balanced`
- `time_horizon = 1y_plus`
- `asset_scope = mixed_etf_and_large_cap_equities`
- `position_count = 4`
- `max_single_position_pct = 35`

#### Options screener defaults

- `direction = bullish` if user asks for calls, bearish for puts
- `dte_target = 25_to_45_days`
- `objective = balanced_leverage_and_probability`
- `moneyness_preference = atm_to_slightly_otm`
- `liquidity_minimum = high_open_interest_and_tight_spread`

#### Output requirement when defaults are used

Every workflow answer must explicitly state:

- which defaults were assumed
- which user preferences were applied
- which constraints were missing

This is non-negotiable. It is the main defense against the criticism that defaults hide too much subjectivity.

---

### 5.4 Memory system

This is the most important design area because it affects:

- personalization
- follow-up quality
- auditability
- debugging
- privacy risk

The design intentionally separates:

1. raw logs
2. structured preferences
3. derived memory summaries

#### 5.4.1 Memory goals

The memory system should allow OpenCandle to remember:

- user risk profile
- time horizon
- favorite asset types
- repeated constraints
- prior recommendations
- prior assumptions
- recent conversation context

without forcing the LLM to re-read entire chat histories.

#### 5.4.2 Storage strategy

Use a hybrid local-only design:

This is the canonical OpenCandle storage layout. Pi runtime config, auth, and model selection remain Pi-managed under `~/.pi/agent/...` and optional project `.pi/` overrides.

1. **SQLite database**
   - canonical store for structured memory and metadata
   - canonical path: `~/.opencandle/state.db`

2. **Append-only JSONL chat logs**
   - raw transcript and event log for debugging / audit
   - canonical path: `~/.opencandle/logs/YYYY/MM/DD/<session-id>.jsonl`

This is the recommended design over "only SQLite" or "only JSON files".

#### Why hybrid storage is the right choice

**Why not only JSON logs?**
- Poor queryability
- Hard to update profile facts
- Hard to resolve conflicts
- Hard to support retention rules and summaries

**Why not only SQLite?**
- Harder to inspect raw sessions manually
- Worse debugging ergonomics
- More friction when reconstructing a faulty run

**Why hybrid wins**
- SQLite stores normalized, queryable memory
- JSONL stores raw auditable history
- Both are local, transparent, and easy to back up

---

## 6. Memory Data Model

### 6.1 SQLite tables

#### `sessions`

Tracks conversation sessions.

Suggested columns:

- `id`
- `started_at`
- `ended_at`
- `cwd`
- `thread_title`
- `memory_enabled`
- `log_path`

#### `messages`

Tracks user and assistant messages at a structured level.

Suggested columns:

- `id`
- `session_id`
- `role`
- `created_at`
- `content_text`
- `workflow_type`
- `message_index`

#### `tool_calls`

Tracks tool usage for each assistant turn.

Suggested columns:

- `id`
- `session_id`
- `message_id`
- `tool_name`
- `args_json`
- `result_summary`
- `success`
- `created_at`

#### `user_preferences`

Canonical user preference store.

Suggested columns:

- `id`
- `namespace`
- `key`
- `value_json`
- `confidence`
- `source`
- `created_at`
- `updated_at`
- `last_confirmed_at`

Example keys:

- `risk_profile`
- `time_horizon`
- `asset_scope`
- `etf_preference`
- `max_single_position_pct`
- `options_style`

#### `memory_facts`

Stores extracted facts that are not stable enough to become preferences but are still useful.

Suggested columns:

- `id`
- `kind`
- `fact_text`
- `value_json`
- `confidence`
- `source_message_id`
- `created_at`
- `expires_at`

Examples:

- `current_goal`
- `recent_candidate_portfolio`
- `watchlist_focus`
- `near_term_topic`

#### `workflow_runs`

Stores structured workflow outputs.

Suggested columns:

- `id`
- `session_id`
- `workflow_type`
- `input_slots_json`
- `resolved_slots_json`
- `defaults_used_json`
- `output_summary`
- `created_at`

#### `recommendations`

Stores recommendation artifacts for future follow-ups and review.

Suggested columns:

- `id`
- `workflow_run_id`
- `recommendation_type`
- `symbol`
- `payload_json`
- `created_at`

This table becomes especially valuable for:

- portfolio follow-ups
- options follow-ups
- recommendation audit

---

### 6.2 JSONL log format

Each session log should be append-only and line-oriented.

Recommended event types:

- `session_start`
- `user_message`
- `assistant_message`
- `tool_call_start`
- `tool_call_end`
- `workflow_selected`
- `slot_resolution`
- `memory_write`
- `session_end`

Example event:

```json
{
  "type": "slot_resolution",
  "timestamp": "2026-03-29T18:10:14.182Z",
  "workflow_type": "portfolio_builder",
  "resolved_slots": {
    "budget": 10000,
    "risk_profile": "balanced",
    "time_horizon": "1y_plus",
    "asset_scope": "mixed_etf_and_large_cap_equities",
    "position_count": 4
  },
  "defaults_used": ["risk_profile", "time_horizon", "asset_scope", "position_count"]
}
```

This log format is intentionally verbose. The point is not prompt context. The point is:

- audit
- debugging
- replay
- offline analysis

---

## 7. Memory Lifecycle

### 7.1 What gets written

#### Always write

- session metadata
- user messages
- assistant messages
- tool calls
- workflow metadata

#### Write only after extraction

- stable user preferences
- memory facts
- workflow summaries

#### Never auto-promote into durable preference memory without confidence

Do not write user preferences just because the model guessed them.

Examples:

- If the system defaults to `balanced`, that should not automatically become a durable preference.
- If the user says `I generally prefer ETFs and lower volatility`, that can become a preference candidate.

---

### 7.2 Preference extraction policy

Extract preferences only from explicit user statements or strong repeated patterns.

#### Safe to persist

- `I prefer ETFs over individual stocks`
- `I am pretty risk averse`
- `Use 12 month horizons unless I say otherwise`
- `I only trade liquid options`

#### Not safe to persist automatically

- defaults used for one turn
- one-off recommendations
- inferred preferences with weak evidence

#### Confirmation policy

If confidence is below a threshold, mark the preference as:

- tentative
- not confirmed

and either:

- ask for confirmation later, or
- use it softly in future turns with disclosure

---

### 7.3 Retrieval policy

Do not inject raw logs into model context.

Instead retrieve, in order:

1. active workflow summary from the current session
2. stable user preferences
3. top 1-3 relevant recent memory facts
4. most recent recommendation artifact if relevant

This should be capped strictly.

Recommended maximum prompt-memory payload:

- user preferences: <= 15 short lines
- relevant session summary: <= 12 short lines
- workflow-specific artifact: <= 1 compact JSON block or bullet list

This design directly avoids the common memory failure mode where context bloats until the agent becomes confused or repetitive.

---

## 8. Proposed User Experience

### 8.1 Portfolio builder flow

#### Example user prompt

`If I had $10k to invest today, what should I invest in?`

#### Proposed behavior

1. Router classifies prompt as `portfolio_builder`
2. Slot resolver extracts:
   - `budget = 10000`
3. It checks memory:
   - if preferences exist, use them
4. If key constraints are missing, ask 1 short follow-up:
   - `Before I build a draft, what fits better: conservative, balanced, or aggressive?`
5. If the user does not answer or stays vague:
   - proceed with `balanced`, `1y_plus`, `4 positions`
6. Run workflow:
   - candidate generation
   - quotes / fundamentals / technicals / risk / correlation
7. Return:
   - assumptions
   - proposed allocation
   - why each position is included
   - diversification notes
   - next-step edits the user can request

#### Example answer shape

- Assumptions
- Draft portfolio
- Why these 4 positions
- Main risks
- What to change if you want more growth / more safety

This is materially better than a refusal and still avoids pretending to know the user's full financial profile.

---

### 8.2 Options screener flow

#### Example user prompt

`Give me the best MSFT call options that are a month out`

#### Proposed behavior

1. Router classifies prompt as `options_screener`
2. Slot resolver extracts:
   - `symbol = MSFT`
   - `direction = bullish`
   - `dte_target = month_out`
3. It checks memory for:
   - options style
   - budget
   - preference for safer vs aggressive setups
4. If needed, ask at most one follow-up:
   - `Do you want safer/liquid calls or higher-upside/speculative ones?`
5. If the user does not specify:
   - default to `balanced_leverage_and_probability`
   - default to `25_to_45_days`
6. Run workflow:
   - quote
   - option chain
   - liquidity filter
   - ranking
7. Return:
   - top ranked contracts
   - reason for ranking
   - premium, delta, IV, OI, spread
   - explicit caveats

#### Important note

This workflow requires improving the tool layer later for better ranking inputs, but the orchestration improvement alone will already be much more useful than the current behavior.

---

## 9. Workflow Implementation Design

### 9.1 New modules

Suggested initial file structure:

```text
src/
  routing/
    classify-intent.ts
  workflows/
    index.ts
    portfolio-builder.ts
    options-screener.ts
    single-asset-analysis.ts
  memory/
    index.ts
    storage.ts
    sqlite.ts
    chat-log.ts
    preference-extractor.ts
    retrieval.ts
    summarizer.ts
    types.ts
  prompts/
    workflow-prompts.ts
```

This structure keeps the new orchestration layer separate from:

- providers
- core tools
- the existing CLI entrypoint

That separation is deliberate. Another agent implementing this should resist the temptation to scatter routing and memory logic throughout unrelated tool files.

---

### 9.2 CLI integration

The CLI should evolve from:

- `read line -> send prompt directly to agent`

to:

- `read line -> classify intent -> resolve slots -> maybe ask clarification -> run workflow`

Suggested high-level flow in `src/index.ts`:

1. receive user input
2. load session + memory context
3. classify workflow
4. resolve slots
5. if follow-up needed, ask it and persist answer
6. run workflow
7. persist logs, outputs, and memory updates

This can be layered in without removing the existing generic agent path.

Fallback behavior:

- if no workflow matches confidently, use current generic agent behavior

---

### 9.3 Recommendation checkpoint

This is the lightest form of human-in-the-loop that still improves usability.

Before finalizing high-impact recommendation flows, provide a checkpoint:

- `I can build a balanced 4-position draft under these assumptions. Continue, or change risk/horizon first?`

Allowed user responses should be simple:

- continue
- edit risk
- edit horizon
- switch to ETF-only

This pattern is preferable to forcing the user through an upfront questionnaire.

---

## 10. Alternatives Considered

### Alternative A: Only improve the system prompt

Rejected as the main strategy.

Why:

- The current problems are structural, not only prompt phrasing problems.
- A better system prompt may help some cases, but it will not provide:
  - durable memory
  - routing
  - slot resolution
  - auditable defaults

Prompt-only solutions are too brittle.

### Alternative B: Ask many follow-up questions before any recommendation

Rejected.

Why:

- It makes the agent feel slower and weaker.
- It creates high drop-off for casual users.
- It causes paralysis on simple prompts.

We want bounded clarification, not a wizard form.

### Alternative C: Full semantic memory / embeddings in v1

Rejected for v1.

Why:

- Overkill for the initial problem
- Higher complexity
- Harder to debug
- Not needed for storing a small number of stable preferences and recent summaries

Structured memory should come first. Semantic retrieval can be added later if justified.

### Alternative D: Store everything only in the current workspace

Rejected.

Why:

- Current cwd-based state is already a UX problem
- Memory should survive launching OpenCandle from different directories
- Preferences are user-level, not project-level

The correct default is a user-scoped app-data location.

---

## 11. Risks and Reviewer Criticisms

This section is included because another agent is expected to criticize the plan.

### Criticism 1: "This is too much architecture for a small CLI tool"

**Defense**

The proposed changes are not a platform rewrite. They are a thin orchestration layer above the existing tool set. The current product already suffers from:

- non-useful broad prompt behavior
- hidden cwd-based state
- no profile memory

Without a small architecture layer, every fix will be ad hoc and will not compose.

### Criticism 2: "Memory is dangerous for a financial product"

**Defense**

Yes, which is why the design is:

- local-only
- inspectable
- structured
- bounded
- explicit about defaults vs confirmed preferences

The danger is not memory itself. The danger is opaque memory. This design minimizes opacity.

### Criticism 3: "Chat logs are overkill"

**Defense**

Raw chat logs are not for prompt injection. They are for:

- audit
- debugging
- reproduction
- memory extraction

Without raw logs, it becomes difficult to explain why a recommendation happened or to diagnose failures across sessions.

### Criticism 4: "Why not just store everything in SQLite and skip JSONL logs?"

**Defense**

Because debugging agents is materially easier with append-only logs that can be read directly and replayed. SQLite is excellent for structured state, not as good for raw timeline inspection.

### Criticism 5: "Defaults may hide subjective choices"

**Defense**

That is exactly why:

- defaults are conservative
- defaults are disclosed
- defaults are separated from remembered preferences

The right alternative is not no defaults. It is transparent defaults.

### Criticism 6: "This still doesn't solve financial-advice compliance concerns"

**Defense**

Correct. This plan is not a compliance solution. It is a usefulness solution. The workflows should continue to frame outputs as:

- sample portfolios
- screened candidates
- assumption-based drafts
- educational analysis

The product becomes more useful without pretending to be personalized fiduciary advice.

---

## 12. Implementation Phases

### Phase 1: Router and slot resolution

Deliverables:

- workflow classifier
- slot extraction
- workflow defaults
- 1-2 follow-up question policy

Success criteria:

- `I have $10k to invest` no longer returns a generic refusal
- `best MSFT calls a month out` no longer dead-ends on clarification

### Phase 2: Local memory foundation

Deliverables:

- SQLite schema
- JSONL log writer
- session lifecycle hooks
- basic preference persistence

Success criteria:

- sessions are logged
- user preferences can be stored and retrieved
- cwd no longer determines conversational memory

### Phase 3: Portfolio builder workflow

Deliverables:

- candidate generation prompt
- screening logic
- risk/diversification pass
- structured response template

Success criteria:

- broad portfolio prompts trigger useful workflows with tools
- outputs include assumptions and draft allocations

### Phase 4: Options screener workflow

Deliverables:

- DTE default handling
- contract ranking heuristics
- safer vs speculative mode
- structured response template

Success criteria:

- broad options prompts yield ranked contracts with rationale

### Phase 5: Memory refinement

Deliverables:

- preference extractor
- memory summaries
- retention rules
- delete/export commands

Success criteria:

- the agent feels more consistent across sessions
- prompt contexts remain compact

---

## 13. Testing Plan

### 13.1 Unit tests

Add unit tests for:

- intent classification
- slot extraction
- default resolution
- preference extraction
- retrieval ranking
- SQLite storage logic
- JSONL append logic

### 13.2 Integration tests

Add integration tests for:

- portfolio prompt with no prior memory
- portfolio prompt with remembered risk profile
- options prompt with no exact expiry given
- options prompt with remembered liquidity preference

### 13.3 End-to-end behavior tests

Add E2E coverage for these exact prompts:

1. `If I had $10k to invest today, what should I invest in?`
2. `Build me a diversified $10k starter portfolio for today's market with 4 positions.`
3. `Give me the best MSFT call options that are a month out.`
4. `I'm conservative and prefer ETFs. What should I buy with $10k?`
5. `Show me safer NVDA call options next month under $500 premium.`

Assertions should include:

- useful tool calls happen
- the answer contains assumptions
- the answer is structured
- the system uses remembered preferences where appropriate

### 13.4 Regression tests

Protect against:

- over-asking follow-ups
- silent preference persistence from defaults
- raw logs being injected wholesale into prompts
- memory context growing unbounded

---

## 14. Success Metrics

Track these after rollout:

### UX metrics

- percentage of recommendation-shaped prompts that trigger at least one tool call
- average number of clarification turns per workflow
- percentage of workflows completed without user rephrasing

### Memory metrics

- percentage of sessions where a remembered preference is applied
- percentage of memory retrievals that are explicit vs default-based
- average injected memory size

### Quality metrics

- user-visible assumption disclosure rate
- recommendation audit completeness
- reduction in generic refusal responses

---

## 15. Open Questions

These questions should be decided during implementation, not before the project starts.

1. Should raw chat logging be enabled by default or opt-in?
   - Recommendation: enabled by default for local-only mode, but clearly disclosed and easily disabled.

2. Should preferences be global or workspace-specific?
   - Recommendation: global by default, with optional workspace overrides later.

3. Should the first recommendation workflow explicitly ask to save a preference?
   - Recommendation: only when confidence is low or when the preference is materially important.

4. Should recommendation artifacts be reusable in later turns?
   - Recommendation: yes, especially for portfolio drafts and options screens.

---

## 16. Recommended Implementation Order

If another agent implements this plan, the best order is:

1. Router + slot extraction + defaults
2. Session logging
3. SQLite memory storage
4. Portfolio builder workflow
5. Options screener workflow
6. Preference extraction and retrieval refinement

This order is intentional:

- it unlocks immediate usefulness first
- it avoids building memory before there is a workflow layer to consume it
- it keeps debugging practical

---

## 17. Appendix: External Patterns That Informed This Plan

These references are included so the implementing agent can inspect the upstream patterns directly.

- [Dexter](https://github.com/virattt/dexter)
  - useful patterns:
    - intelligent task planning
    - self-validation
    - scratchpad logging

- [OpenBB Agents](https://github.com/OpenBB-finance/experimental-openbb-platform-agent)
  - useful patterns:
    - support for complex and temporally dependent user queries
    - dynamic behavior based on available data providers

- [Open Interpreter](https://github.com/openinterpreter/open-interpreter)
  - useful patterns:
    - profiles
    - configurable behavior
    - verbose mode for inspection

- [LangGraph Agent Inbox](https://github.com/langchain-ai/agent-inbox)
  - useful patterns:
    - structured human-interrupt handling
    - edit / accept / ignore response model

- [AI Hedge Fund](https://github.com/virattt/ai-hedge-fund)
  - useful patterns:
    - role separation between analysts, risk manager, and portfolio manager

- [TradingAgents](https://github.com/TauricResearch/TradingAgents)
  - useful patterns:
    - multi-stage financial workflow rather than one-shot recommendations

- [TradingGoose](https://github.com/TradingGoose/Trading-Goose.github.io)
  - useful patterns:
    - portfolio manager constrained by user risk and allocation settings
    - audit trail emphasis

- [AutoHedge](https://github.com/The-Swarm-Corporation/AutoHedge)
  - useful patterns:
    - structured output
    - risk-first pipeline

---

## Bottom Line

OpenCandle does not need a bigger tool catalog to become much more useful on real-user prompts. It needs:

- workflow routing
- bounded clarification
- transparent defaults
- durable memory
- auditable logs

The memory system is central, but it should be implemented as a pragmatic local hybrid:

- SQLite for structured state
- JSONL for raw history

This is the smallest design that can credibly improve:

- recommendation quality
- repeat-session usefulness
- debugging
- user trust

without destabilizing the existing codebase.
