# OpenCandle Eval Framework Plan

> Context preserved from exploration session (2026-04-03). This document captures the full research and design thinking for the eval framework, to be implemented after the test harness is built.

## Purpose

Deterministic-as-possible regression detection: does a new feature or change make OpenCandle worse as a financial agent? The eval framework consumes structured traces produced by the test harness and scores them against baseline measurements.

---

## Research Summary

### How peer projects handle evals

| Project | Eval Approach | Key Insight |
|---------|--------------|-------------|
| **Gemini CLI** | Two-tier: `ALWAYS_PASSES` (every CI) + `USUALLY_PASSES` (nightly, 6 models x 3 attempts) | Acknowledges non-determinism. Graduate evals from USUALLY to ALWAYS as they stabilize. |
| **Codex CLI** | No evals in open-source repo. Deterministic unit/integration tests with wiremock SSE mocks + VT100 snapshot testing. | Separates "does the code work" (deterministic) from "does the agent behave well" (presumably internal). |
| **OpenCode** | Almost no tests at all (4 test files, CI doesn't run them). | Not a model to follow. |
| **Pi Framework** | Fake ExtensionAPI pattern for unit tests, SessionManager.inMemory() for integration. No eval framework. | Good test infrastructure but no quality measurement. |

### Frameworks evaluated

| Framework | Language | Fit for OpenCandle | Notes |
|-----------|----------|-------------------|-------|
| **vitest-evals** (Sentry) | TypeScript | Best fit | Adds `describeEval` + `ToolCallScorer` to Vitest. Zero new infrastructure. |
| **Promptfoo** | TypeScript | Good for LLM-judge | YAML-driven, `llm-rubric` assertions, GitHub Action. Acquired by OpenAI March 2026. |
| **Evalite** (Matt Pocock) | TypeScript | Possible | Built on Vitest, local web UI. v1 beta. |
| **Braintrust** | TS + Python | Overkill for now | Platform-oriented. Valuable at scale with production traffic. |
| **DeepEval** | Python | Poor fit | Python-primary. Wrong language for this project. |
| **Inspect AI** (UK AISI) | Python | Poor fit | Same — Python-only. |
| **LangSmith** | TS + Python | Overkill for now | Platform-oriented. Framework-agnostic despite LangChain name. |
| **RAGAS** | Python | Not applicable | RAG-focused. Faithfulness metric concept is useful but can be custom-built. |

### Making evals deterministic

From Anthropic's engineering guidance and academic research:

1. **Deterministic (code-based) graders first** — exact string match, JSON schema validation, regex, numeric range checks. Fully reproducible.
2. **LLM judges where necessary** — for open-ended quality assessment.
   - Low temperature (0.1) for near-deterministic scoring
   - Categorical integer scales (1-5), not continuous floats
   - Atomized evaluation — one quality dimension per judge call
   - Chain-of-thought before scoring
   - Few-shot examples (2-3 per category) improve accuracy 25-30%
3. **Average across 3+ runs** to absorb non-deterministic variance.
4. **Track rolling pass rates** — flag drops > 10% below baseline.

---

## Eval Architecture

### Layer model

```
Layer 1: Intent Classification (deterministic, every CI)
  "AAPL stock price" → market intent
  "What's the P/E ratio of MSFT" → fundamentals intent
  "Should I buy calls on TSLA" → options intent
  Scoring: exact match against expected intent categories

Layer 2: Tool Selection Correctness (deterministic, every CI)
  Given prompt, did the agent call the right tools?
  Scoring: trajectory matching
    required_tools ⊆ actual_tools (recall)
    actual_tools ⊆ allowed_tools (precision)
    penalize unnecessary tool calls (efficiency)

Layer 3: Tool Argument Correctness (deterministic, every CI)
  Did the right arguments get passed?
  "Compare AAPL and MSFT" → symbol args include both
  Scoring: exact match on key arguments

Layer 4: Data Faithfulness (deterministic, every CI)
  Every number in the response appears in tool output.
  No hallucinated metrics, prices, ratios.
  Scoring:
    1. Extract all numbers from final text
    2. Check each against union of all tool results in trace
    3. Flag any number not grounded in tool output
  This catches the most dangerous financial agent failure mode.

Layer 5: Risk Disclosure (deterministic, every CI)
  Response contains disclaimer text (regex)
  No "guaranteed", "risk-free", "can't lose"
  For any BUY signal, at least one risk factor mentioned
  Scoring: regex + keyword search

Layer 6: Analysis Quality (LLM-judge, nightly)
  Rubric items (each scored binary):
    a. Data Collection Completeness — references data from multiple tool categories?
    b. Quantitative Screen Present — explicit PASS/FAIL on screening criteria?
    c. Risk Check Present — mentions volatility, drawdown, or VaR?
    d. Reasoning Chain Explicit — "Because [data] + [data], I conclude [thesis]"?
    e. Actionable Conclusion — clear directional view with conviction level?
  Scoring: LLM-as-judge, atomized per rubric item, temperature 0.1, few-shot

Layer 7: E2E Workflow (LLM-judge + trajectory, nightly)
  Full conversation flows including multi-turn interactions
  Multi-analyst orchestration completeness
  Scoring: trajectory matching + LLM quality assessment
```

### Eval case format

```typescript
interface EvalCase {
  name: string;
  tier: "always" | "usually";  // Gemini CLI's model
  prompt: string;
  answers?: Record<string, string>;  // scripted answers for ask_user questions
  assertions: {
    // Deterministic (Layer 1-5)
    expectedIntent?: string;
    requiredTools?: string[];
    forbiddenTools?: string[];
    requiredArgs?: Record<string, Record<string, unknown>>;
    responseContains?: (string | RegExp)[];
    responseNotContains?: (string | RegExp)[];
    dataFaithfulness?: boolean;  // enable numeric grounding check

    // LLM-judge (Layer 6-7)
    rubric?: string[];
  };
}
```

### Scoring and regression detection

```typescript
interface EvalReport {
  cases: Array<{
    name: string;
    tier: "always" | "usually";
    score: number;            // 0.0 - 1.0
    details: Record<string, { passed: boolean; message?: string }>;
  }>;
  aggregate: number;           // weighted average
  baseline: number | null;     // from baseline.json, null if first run
  delta: number | null;
  regression: boolean;         // true if delta < -0.05
  improved: string[];          // cases that got better
  regressed: string[];         // cases that got worse
  unchanged: string[];         // cases within noise threshold
}
```

### Baseline management

- Stored in `tests/evals/baseline.json`, checked into git
- Contains per-case scores from last accepted run
- Updated manually: `npx oc-eval --update-baseline`
- Before merging a feature branch: run evals, compare against baseline on main

### Recommended starter eval cases (20-25)

Drawing from existing e2e tests + uncovered domains:

**Routing (Layer 1-2):**
1. Stock quote — "What's AAPL trading at?"
2. Technical analysis — "Run technicals on SPY"
3. Backtest — "Backtest SMA crossover on SPY 2 years"
4. SEC filings — "Show recent SEC filings for Apple"
5. Correlation — "Correlation between AAPL, MSFT, GOOGL"
6. Options chain — "Show options chain for TSLA"
7. Fear & Greed — "What's the Fear and Greed index?"
8. Macro data — "What's the current GDP growth rate?"
9. Reddit sentiment — "What's Reddit saying about NVDA?"
10. DCF valuation — "Run a DCF on AAPL"

**Multi-turn workflows (Layer 2-3, need ask_user harness):**
11. Portfolio builder (conservative) — "Build me a portfolio with $50k"
12. Portfolio builder (aggressive) — same prompt, different answers
13. Options screener — "Find covered call candidates"
14. Compare assets — "Compare AAPL and MSFT"
15. Comprehensive analysis — "analyze NVDA"

**Data faithfulness (Layer 4):**
16. Quote accuracy — verify reported price matches tool output
17. Ratio accuracy — verify P/E, market cap match fundamentals tool
18. Backtest metrics — verify return %, drawdown match tool output

**Risk disclosure (Layer 5):**
19. Bullish recommendation — must include risk factors
20. High-conviction signal — must include disclaimer
21. No "guaranteed" language — across various prompts

**Quality (Layer 6, LLM-judge):**
22. Analysis depth — comprehensive analysis produces multi-dimensional view
23. Reasoning chain — conclusions cite specific data points
24. Balanced perspective — both bull and bear cases presented

---

## Implementation plan

### Phase 1: Deterministic evals on existing test infrastructure
- Install `vitest-evals`
- Convert existing e2e test cases to eval format
- Add tool argument and data faithfulness checks
- Run as part of `npm test` for `always` tier

### Phase 2: Harness-dependent evals
- After test harness is built, add multi-turn workflow evals
- Portfolio builder, options screener, compare assets paths
- These require the ask_user IPC mechanism

### Phase 3: LLM-judge evals
- Add Promptfoo or custom LLM-judge scorer
- Define rubrics for analysis quality
- Run nightly or on-demand, not in CI
- Track pass rates over time

### Phase 4: Regression workflow
- Baseline management tooling
- CI integration for `always` tier
- PR comment bot showing regression/improvement summary
- Graduate `usually` evals to `always` as they stabilize

---

## Key design decisions (from exploration)

1. **Live LLM for all evals** — mocked responses only test routing, not synthesis quality. Use live LLM with 3x averaging for the `usually` tier.

2. **vitest-evals as the base** — it's TypeScript-native, Vitest-native (which OpenCandle already uses), and adds eval semantics without new infrastructure.

3. **Promptfoo for LLM-judge** — YAML-driven, supports `llm-rubric`, has GitHub Action. Use for Layer 6-7 only.

4. **Gemini CLI's two-tier model** — `always` (deterministic, every CI) vs `usually` (LLM-dependent, nightly/on-demand). This is the right mental framework for a non-deterministic system.

5. **Data faithfulness is the most valuable deterministic check** — extracting numbers from responses and verifying against tool output catches the most dangerous financial agent failure mode (hallucinated metrics).

6. **Baseline stored in git** — simple, version-controlled, no external dependencies. Updated explicitly, not automatically.

---

## References

- [vitest-evals (Sentry)](https://github.com/getsentry/vitest-evals) — Vitest extension with `describeEval`, `ToolCallScorer`
- [Promptfoo](https://www.promptfoo.dev/) — YAML-driven eval with `llm-rubric` assertions
- [Anthropic: Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Gemini CLI evals](https://github.com/google-gemini/gemini-cli/tree/main/evals) — Two-tier eval model with ALWAYS_PASSES/USUALLY_PASSES
- [FinGAIA Benchmark](https://arxiv.org/html/2507.17186v1) — Financial agent evaluation (407 tasks, 7 sub-domains)
- [Rulers: Rubric-Anchored Scoring](https://arxiv.org/html/2601.08654) — Making rubric-based evaluation deterministic
- [ECLIPSE: Hallucination Detection in Finance](https://arxiv.org/abs/2512.03107) — Semantic entropy for financial QA
