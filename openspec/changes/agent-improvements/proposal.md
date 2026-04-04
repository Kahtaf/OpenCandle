# Agent Improvements: Patterns from Top Agents

**Status**: Exploring  
**Goal**: Make OpenCandle the best financial agent on the market by adopting proven patterns from top open-source agents (financial and coding).

## Research Sources

- **Financial agents**: TradingAgents (46K★), FinRobot (6.5K★), FinGPT (14K★), OpenBB (65K★), FinSight, TradingGoose
- **Coding agents**: Claude Code, OpenHands (53K★), SWE-Agent (16K★), Aider (43K★), Devin
- **Frameworks**: CrewAI, LangGraph, AutoGen

---

## Improvement Backlog

### 1. Adversarial Bull/Bear Debate ← EXPLORING FIRST

**Stolen from**: TradingAgents (46K stars — most-starred financial agent)

**What**: After the 5 analysts produce signals, a Bull Researcher and Bear Researcher debate for 1-3 rounds before synthesis. The synthesis step then resolves tension rather than politely merging.

**Why high impact**: The current synthesis step is a polite average of 5 opinions. Debate forces the agent to confront its own weaknesses, producing more balanced and trustworthy analysis. This is the feature that made TradingAgents go viral.

**Effort**: Medium — two new prompt roles, a debate loop in orchestrator, no new tools.

**Files**: `src/analysts/orchestrator.ts`, `src/analysts/contracts.ts`, `src/runtime/workflow-types.ts`

---

### 2. Structured Report Output

**Stolen from**: FinRobot (equity research reports w/ charts), FinSight (20K-word reports w/ citations)

**What**: A `/report TICKER` command that produces a structured, saveable equity research report (markdown) with sections: Executive Summary, Financial Analysis, Valuation, Technical Setup, Sentiment, Risk Factors, Peer Comparison, Data Sources.

**Why high impact**: Chat is ephemeral. Reports are artifacts users save and share. FinSight's citation chain (every number traces to a tool output) also solves the hallucination trust problem.

**Effort**: Medium — new workflow in `src/workflows/`, new prompt template. Reuses all existing analysts and tools. The data is already there; this is about presentation.

**Files**: `src/workflows/report-builder.ts` (new), `src/prompts/workflow-prompts.ts`, `src/pi/opencandle-extension.ts`

---

### 3. Compact Tool Outputs

**Stolen from**: SWE-Agent research (ACI paper)

**What**: Audit all 23 tools to ensure they return pre-formatted, token-efficient summaries. Never dump raw API JSON to the LLM. Surface the important numbers first. Prune noise fields.

**Why high impact**: SWE-Agent proved tool interface design adds 10+ percentage points to agent performance. This is the lowest-effort, highest-leverage change.

**Effort**: Low — audit + refactor tool return values. No new code, just tightening existing code.

**Files**: Every file in `src/tools/`

---

### 4. Data Availability Map

**Stolen from**: Aider's repository map (PageRank-ordered codebase summary in ~1K tokens)

**What**: At session start, inject a compact summary of: which providers are configured, rate limits remaining, cached data available, portfolio/watchlist state, last session context. Helps the LLM make smarter tool routing decisions.

**Why high impact**: Prevents wasted API calls (don't burn AlphaVantage rate limit on a simple quote), gives users confidence the agent knows its own state.

**Effort**: Low — aggregate from `src/infra/` rate-limiter and cache. Format as a compact block for system prompt injection.

**Files**: `src/infra/` (read state), `src/system-prompt.ts` (inject), new `src/runtime/data-map.ts`

---

### 5. Error Recovery Hierarchy

**Stolen from**: Anthropic's harness research (compounding failure paper)

**What**: Three-level recovery in the workflow runner:
1. Retry with enriched error context
2. Fallback to alternate provider
3. Graceful degradation (skip step, flag reduced confidence)

**Why high impact**: At 95% per-step reliability, a 20-step workflow succeeds only 36% of the time. Codified recovery makes multi-analyst workflows robust.

**Effort**: Medium — changes in `src/runtime/workflow-runner.ts` and `src/infra/`.

**Files**: `src/runtime/workflow-runner.ts`, `src/infra/http-client.ts`, provider files

---

### 6. MCP Server

**Stolen from**: OpenBB (65K stars — most-starred financial project on GitHub)

**What**: Expose OpenCandle's 23 tools as an MCP server. Makes OpenCandle usable from Claude Code, Cursor, Windsurf, or any MCP client. Becomes a composable financial data backbone.

**Why high impact**: Distribution moat. Other agents consume your tools. OpenBB's trajectory validates this as the direction the ecosystem is moving.

**Effort**: Medium — tools are already well-structured in `src/tools/`. Wrapping in MCP server format is mostly boilerplate.

**Files**: New `src/mcp/` directory, existing tool definitions unchanged

---

### 7. Session Summaries / Context Compaction

**Stolen from**: Claude Code's AutoCompact system

**What**: After each workflow step completes, compress findings into a typed intermediate summary. Don't keep full API response history in context for long-running sessions.

**Effort**: Medium

---

### 8. Progress Tracking Artifact

**Stolen from**: Anthropic's `claude-progress.txt` pattern

**What**: For long workflows, write `analysis-progress.json` tracking completed steps, pending steps, and intermediate findings.

**Effort**: Low

---

### 9. Per-Directory AGENTS.md

**Stolen from**: Codified context research (29% median runtime reduction, 17% token savings)

**What**: Add AGENTS.md files to `src/tools/` subdirectories with domain-specific context.

**Effort**: Low — already partially done

---

## Priority Order

| # | Pattern | Effort | Impact | Status |
|---|---------|--------|--------|--------|
| 1 | Bull/Bear Debate | Med | Very High | ← Exploring |
| 2 | Structured Reports | Med | Very High | Backlog |
| 3 | Compact Tool Outputs | Low | High | Backlog |
| 4 | Data Availability Map | Low | High | Backlog |
| 5 | Error Recovery | Med | High | Backlog |
| 6 | MCP Server | Med | High | Backlog |
| 7 | Session Summaries | Med | Medium | Backlog |
| 8 | Progress Tracking | Low | Medium | Backlog |
| 9 | Per-Dir AGENTS.md | Low | Medium | Backlog |
