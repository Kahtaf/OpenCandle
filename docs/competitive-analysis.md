# Vantage Competitive Analysis: Open-Source Financial AI Agents

**Date:** 2026-03-29
**Purpose:** Identify what Vantage can learn from existing open-source financial agents — algorithms, tools, APIs, system prompts, and architectural patterns — and provide actionable recommendations.

---

## Table of Contents

1. [Vantage Current State](#vantage-current-state)
2. [Competitor Directory](#competitor-directory)
3. [Per-Competitor Analysis: What to Steal](#per-competitor-analysis)
4. [Cross-Cutting Patterns](#cross-cutting-patterns)
5. [Prioritized Feature Recommendations](#prioritized-feature-recommendations)
6. [What NOT to Build](#what-not-to-build)
7. [Implementation Sequencing](#implementation-sequencing)
8. [API Endpoints Reference](#api-endpoints-reference)

---

## 1. Vantage Current State

Before analyzing competitors, here's what Vantage already has (15 tools):

| Category | Tools | Data Sources |
|----------|-------|-------------|
| Market Data (5) | search_ticker, get_stock_quote, get_stock_history, get_crypto_price, get_crypto_history | Yahoo Finance, CoinGecko |
| Fundamentals (3) | get_company_overview, get_financials, get_earnings | Alpha Vantage |
| Macro (2) | get_economic_data, get_fear_greed | FRED, CNN Fear & Greed |
| Sentiment (2) | get_reddit_sentiment, get_news_sentiment | Reddit |
| Technical (1) | get_technical_indicators (SMA, EMA, RSI, MACD, Bollinger Bands) | Computed locally |
| Portfolio (2) | track_portfolio, analyze_risk (Sharpe, VaR, max drawdown) | Local computation + JSON persistence |

**Stack:** TypeScript, pi-agent framework, Gemini 2.5 Flash, Vitest
**Architecture:** Multi-analyst orchestrator (Fundamental, Technical, Sentiment, Risk + Synthesis)

---

## 2. Competitor Directory

### Tier 1: Major Projects (10,000+ stars)

| # | Project | Stars | Stack | Description |
|---|---------|-------|-------|-------------|
| 1 | [OpenBB](https://github.com/OpenBB-finance/OpenBB) | ~63,800 | Python, FastAPI | Leading open-source financial data platform. ~100 data source integrations, SDK, MCP servers. |
| 2 | [AI Hedge Fund](https://github.com/virattt/ai-hedge-fund) | ~49,700 | Python, LangGraph | Multi-persona agent hedge fund. Named investor agents (Damodaran, Graham, Burry, Cathie Wood) making consensus decisions. |
| 3 | [TradingAgents](https://github.com/TauricResearch/TradingAgents) | ~43,700 | Python, LangGraph | 7 agent roles mirroring real trading firms. Debate-style decisions. Published academic paper (arXiv:2412.20138). |
| 4 | [Dexter](https://github.com/virattt/dexter) | ~20,400 | TypeScript, LangChain | Autonomous deep financial research agent. SEC filing reader, self-validation loop, skill system. |
| 5 | [FinGPT](https://github.com/AI4Finance-Foundation/FinGPT) | ~18,900 | Python, PyTorch | Fine-tuned financial LLMs. Sentiment analysis F1 of 87.62%. Data curation pipeline. |
| 6 | [FinRL](https://github.com/AI4Finance-Foundation/FinRL) | ~14,600 | Python, Stable Baselines 3 | Reinforcement learning for trading. Train-test-trade pipeline with Gym environments. |
| 7 | [AI-Trader](https://github.com/HKUDS/AI-Trader) | ~12,000 | Python | Live trading benchmark with real money across US stocks, A-shares, and crypto. |

### Tier 2: Notable Projects (1,000-10,000 stars)

| # | Project | Stars | Stack | Description |
|---|---------|-------|-------|-------------|
| 8 | [Anthropic Financial Services Plugins](https://github.com/anthropics/financial-services-plugins) | ~7,100 | Python, MCP | Official Anthropic plugins: DCF, comps, LBO models, tax-loss harvesting, SEC filings. Professional-grade. |
| 9 | [FinRobot](https://github.com/AI4Finance-Foundation/FinRobot) | ~6,500 | Python, LangChain | Financial Chain-of-Thought (FinCoT) prompting. Market forecasting, document analysis agents. |
| 10 | [awesome-ai-in-finance](https://github.com/georgezouq/awesome-ai-in-finance) | ~5,500 | Curated list | Definitive list of LLMs, deep learning strategies, and tools in finance. Reference resource. |
| 11 | [OpenAlice](https://github.com/TraderAlice/OpenAlice) | ~3,000 | TypeScript | File-driven AI trading agent for crypto and securities. |
| 12 | [Polymarket Agents](https://github.com/Polymarket/agents) | ~2,700 | Python | Official Polymarket framework for AI agents trading on prediction markets. |
| 13 | [Financial Datasets MCP](https://github.com/financial-datasets/mcp-server) | ~1,700 | Python | Clean MCP server for stock market data (income statements, balance sheets, prices, news). |
| 14 | [Microsoft MarS](https://github.com/microsoft/MarS) | ~1,700 | Python, PyTorch | Order-level market simulation engine. Generative foundation model for market microstructure. |
| 15 | [ATLAS](https://github.com/chrisworsey55/atlas-gic) | ~1,300 | Python | Self-improving trading agents. Darwinian prompt selection. 25+ agents debating markets daily. |

### Tier 3: Emerging / Specialized

| # | Project | Stars | Stack | Description |
|---|---------|-------|-------|-------------|
| 16 | [FinMem](https://github.com/pipiku915/FinMem-LLM-StockTrading) | ~870 | Python | Layered memory architecture for trading agents, aligned with human trader cognitive structures. |
| 17 | [StockAgent](https://github.com/MingyuJ666/Stockagent) | ~550 | Python | Multi-agent simulation of investor trading behaviors with event-driven phases. |
| 18 | [financial-agent](https://github.com/virattt/financial-agent) | ~250 | Python, LangChain | Minimal reference implementation of a LangChain financial agent with Polygon API. |
| 19 | [AgenticTrading](https://github.com/Open-Finance-Lab/AgenticTrading) | ~110 | Python | MCP/A2A protocol integration, Neo4j memory, DAG-based strategy orchestration. |

### Financial MCP Servers (Tool Infrastructure)

| Project | Data Source | Key Tools |
|---------|-------------|-----------|
| [financial-datasets/mcp-server](https://github.com/financial-datasets/mcp-server) | Financial Datasets API | Income statements, balance sheets, cash flow, prices |
| [yahoo-finance-mcp](https://github.com/Alex2Yang97/yahoo-finance-mcp) | Yahoo Finance | Historical prices, financials, options, news |
| [maverick-mcp](https://github.com/wshobson/maverick-mcp) | Multiple | Technical indicators, portfolio optimization |

---

## 3. Per-Competitor Analysis

### 3.1 OpenBB (63.8k stars)

**What they do well:** Breadth of data coverage (~100 sources). MCP server support. Single integration layer for multiple consumption surfaces.

**What to steal:**

| Idea | Relevance | Why |
|------|-----------|-----|
| SEC EDGAR filing fetcher (10-K, 10-Q, 8-K) | **HIGH** | Free API, no key needed. Vantage has zero SEC data. Filings contain material info not in price/fundamentals APIs. |
| Options chain data via Yahoo Finance | **MEDIUM** | Yahoo options endpoint is free and accessible with same approach as existing Yahoo provider. Reveals institutional positioning. |
| Insider trading data (SEC Form 4) | **MEDIUM** | Public EDGAR data showing insider buys/sells — strong signal. |
| Sector/industry screening | **LOW** | Requires maintaining a symbol universe. Better addressed through search_ticker improvements. |

**How to apply to Vantage:**

**SEC EDGAR integration:**
- New provider: `src/providers/sec-edgar.ts`
- Search endpoint: `https://efts.sec.gov/LATEST/search-index?q=${symbol}&forms=10-K,10-Q,8-K`
- Full-text search: `https://efts.sec.gov/LATEST/search-index?q=${query}`
- Rate limit: SEC asks for 10 req/sec max with a descriptive User-Agent header
- New tool: `get_sec_filings` — takes symbol, returns recent filings with links, dates, form types
- Filing text can be fetched from EDGAR archive URLs (HTML) and truncated to fit context
- Rate limiter config: `rateLimiter.configure("sec", 10, 10)`

**Options chain:**
- Extend `src/providers/yahoo-finance.ts` with a `getOptionsChain` function
- Endpoint: `https://query1.finance.yahoo.com/v7/finance/options/${symbol}`
- Returns: calls/puts with strike prices, expiry dates, open interest, implied volatility, volume
- New tool: `get_options_chain` in `src/tools/market/options-chain.ts`

---

### 3.2 AI Hedge Fund (49.7k stars)

**What they do well:** Named investor persona agents, each embodying a distinct investment philosophy. Consensus voting mechanism.

**What to steal:**

| Idea | Relevance | Why |
|------|-----------|-----|
| Named investor personas with distinct frameworks | **HIGH** | Vantage already has 4 analyst roles but they're generic. Persona prompts produce dramatically more interesting, varied analysis. Purely a prompt change — zero infrastructure cost. |
| Consensus voting (BUY/HOLD/SELL with conviction) | **HIGH** | Vantage's current synthesis asks the LLM to weigh everything qualitatively. Structured voting is more rigorous and auditable. |
| Valuation-specific analyst (DCF, comps) | **HIGH** | Vantage has fundamental data but no valuation model. A DCF tool is a significant differentiator. |

**How to apply to Vantage:**

**Named personas — modify `src/analysts/orchestrator.ts`:**

Replace generic analyst roles with named investment philosophy personas:

1. **Valuation Analyst (Damodaran-style):** Prompt instructs to compute intrinsic value using DCF. Uses get_financials for FCF data + new `compute_dcf` tool. Focuses on: growth rate assumptions, discount rate sensitivity, margin of safety.

2. **Value Analyst (Graham/Buffett-style):** Focuses on margin of safety, P/E vs industry average, debt-to-equity ratio, consistent earnings growth over 5+ years. Uses existing get_company_overview + get_earnings.

3. **Contrarian Analyst (Burry-style):** Specifically looks for overvalued consensus trades, sentiment divergence from fundamentals, red flags in financials that the market ignores. Cross-references sentiment data against fundamentals.

4. **Momentum Analyst (O'Neil/CAN SLIM-style):** Focuses on relative strength, volume breakouts, earnings acceleration, new highs. Uses technical + earnings tools.

**Consensus voting — structured output from each persona:**
```
Each analyst must end with:
SIGNAL: BUY | HOLD | SELL
CONVICTION: 1-10
THESIS: [one sentence]
```
Synthesis prompt tallies signals and weighted convictions to produce a final verdict.

---

### 3.3 TradingAgents (43.7k stars)

**What they do well:** 7 distinct agent roles mirroring real trading firms. Debate-style decision process where agents challenge each other.

**What to steal:**

| Idea | Relevance | Why |
|------|-----------|-----|
| Debate/challenge mechanism between analysts | **MEDIUM** | More nuanced output, but doubles token cost. Worth it for deep analysis only. |
| Separate News Analyst vs Sentiment Analyst | **MEDIUM** | Reddit sentiment (retail noise) is different from news analysis (institutional events). Splitting makes sense analytically. |
| "Researcher" role for additional context | **LOW** | Would require web search capability Vantage doesn't have. |

**How to apply to Vantage:**

**Debate mechanism — optional `--deep` analysis mode:**
- After initial 4 analyst passes, add a challenge round
- Each analyst gets a challenge prompt: "Review the [other analyst]'s conclusion. What's the strongest counterargument? What assumptions might be wrong?"
- Synthesis then has both original analyses and challenges
- Implementation: add `runDebateRound` function in orchestrator
- Only trigger on explicit "deep analysis" requests to control token cost

---

### 3.4 Dexter (20.4k stars)

**What they do well:** TypeScript-based (closest to Vantage's stack). Self-validation loop, SEC filing reader, scratchpad logging, skill system with YAML frontmatter.

**What to steal:**

| Idea | Relevance | Why |
|------|-----------|-----|
| Self-validation loop | **HIGH** | After analysis, agent re-checks cited numbers against tool output. Catches hallucinated financial numbers — the single most dangerous failure mode. Simple prompt addition. |
| Scratchpad / reasoning log | **MEDIUM** | Persisting intermediate reasoning. Useful for multi-session tracking. |
| Skill system | **LOW** | Vantage's tool system already serves this purpose. Over-engineering at current scale. |

**How to apply to Vantage:**

**Self-validation — add to `src/analysts/orchestrator.ts`:**
```typescript
// After synthesis, add validation step:
agent.followUp({
  role: "user",
  content: [{
    type: "text",
    text: `**[Validation Check]** Review your analysis above. For each specific
number you cited (price, P/E, revenue, RSI, etc.), verify it matches the tool
output data. Flag any inconsistencies. If you stated a price or ratio without
fetching it first, call that out as unverified.
Output: VALIDATED or list specific corrections.`
  }],
  timestamp: Date.now(),
});
```
One extra LLM call. Catches the most dangerous failure mode in financial AI.

Could also add a programmatic check: compare numbers in synthesis text against `details` objects returned by tools.

---

### 3.5 FinGPT (18.9k stars)

**What they do well:** Fine-tuned financial NLP models. Sentiment F1 of 87.62%. Data curation pipeline.

**What to steal:**

| Idea | Relevance | Why |
|------|-----------|-----|
| Structured quantitative sentiment scoring | **HIGH** | Vantage currently returns raw Reddit posts. No actual sentiment score. Adding a keyword-based score makes sentiment quantitative. |
| Financial-specific prompt templates | **MEDIUM** | FinGPT's classification prompts can be adapted for Gemini. |
| Fine-tuned model | **LOW** | Requires GPU infra. Not feasible for Vantage. |

**How to apply to Vantage:**

**Quantitative sentiment scoring — modify `src/providers/reddit.ts`:**

```typescript
const BULLISH_TERMS = ["moon", "buy", "undervalued", "breakout", "calls",
  "bullish", "rocket", "diamond hands", "accumulate", "dip buy"];
const BEARISH_TERMS = ["crash", "overvalued", "sell", "puts", "bearish",
  "bubble", "dump", "short", "bagholding", "exit"];

function scoreSentiment(text: string): number {
  const lower = text.toLowerCase();
  const bullish = BULLISH_TERMS.filter(t => lower.includes(t)).length;
  const bearish = BEARISH_TERMS.filter(t => lower.includes(t)).length;
  const total = bullish + bearish;
  if (total === 0) return 0;
  return (bullish - bearish) / total; // -1.0 to +1.0
}
```

Add to `RedditSentimentResult`: `sentimentScore: number`, `bullishCount: number`, `bearishCount: number`

Crude but gives the LLM a number to reference instead of interpreting raw post titles.

---

### 3.6 FinRL (14.6k stars)

**What they do well:** Reinforcement learning for trading. Clean train-test-trade pipeline.

**What to steal:**

| Idea | Relevance | Why |
|------|-----------|-----|
| Historical backtesting concept | **MEDIUM** | "What would have happened" is a natural question. Reuses existing indicator computations. |
| RL training environments | **LOW** | Requires GPU infra. Vantage is advisory, not execution. |

**How to apply to Vantage:**

**Simple backtesting tool — new `src/tools/technical/backtest.ts`:**

Parameters: `symbol`, `strategy` (SMA crossover, RSI mean-reversion, buy-and-hold), `period`

Strategies (all computed locally using existing `indicators.ts` functions):
- **SMA Crossover:** Buy when SMA(20) > SMA(50), sell on reverse
- **RSI Mean Reversion:** Buy when RSI < 30, sell when RSI > 70
- **Buy-and-Hold:** Baseline comparison

Output: total return, max drawdown, number of trades, win rate, comparison to buy-and-hold

Pure computation — no new APIs needed.

---

### 3.7 AI-Trader (12k stars)

**What they do well:** Live trading benchmark with real money. Performance tracking.

**What to steal:**

| Idea | Relevance | Why |
|------|-----------|-----|
| Portfolio P&L tracking over time | **MEDIUM** | Currently Vantage only shows current snapshot. Historical tracking helps evaluate decisions. |
| Paper trading mode | **LOW** | Requires execution simulation. Beyond advisory scope. |

**How to apply to Vantage:**

Extend `Position` type to include snapshots: `Array<{date: string, price: number, value: number}>`. When viewing portfolio, append today's snapshot. New tool `get_portfolio_history` reads snapshots and computes daily P&L, cumulative return, and comparison to SPY.

---

### 3.8 Anthropic Financial Services Plugins (7.1k stars)

**What they do well:** Professional-grade financial tools: DCF, comps, LBO models, tax-loss harvesting, portfolio rebalancing, SEC filing analysis. The gold standard for tool-calling patterns in finance.

**What to steal:**

| Idea | Relevance | Why |
|------|-----------|-----|
| DCF valuation model | **HIGH** | Most-requested valuation method. Pure local math. Requires fixing cash flow data gap first. |
| Comparable company analysis | **HIGH** | Fetch key ratios for a company + sector peers, rank them. Achievable with existing Alpha Vantage. |
| Tax-loss harvesting suggestions | **MEDIUM** | For portfolio positions with unrealized losses, suggest selling and identify replacement securities. Useful but niche. |
| Portfolio rebalancing | **MEDIUM** | Given target allocations and current positions, compute trades needed. Simple math. |

**How to apply to Vantage:**

**DCF tool — new `src/tools/fundamentals/dcf.ts`:**

Parameters: `symbol`, `growth_rate` (optional), `discount_rate` (default 10%), `terminal_growth` (default 3%), `years` (default 5)

Algorithm:
1. Fetch financials via `getFinancials` for latest free cash flow (requires adding `CASH_FLOW` API call to alpha-vantage provider first)
2. Project FCF forward: `FCF * (1 + growth_rate)^year` for each year
3. Terminal value: `FCF_final * (1 + terminal_growth) / (discount_rate - terminal_growth)`
4. Discount all cash flows: `PV = CF / (1 + discount_rate)^year`
5. Sum = enterprise value estimate
6. Subtract net debt (from balance sheet), divide by shares outstanding = intrinsic value per share
7. Compare to current price = margin of safety percentage

Output: intrinsic value, margin of safety, sensitivity table (varies growth and discount rates)

**Comps tool — new `src/tools/fundamentals/comps.ts`:**

Parameters: `symbols` (array of 2-6 tickers)

Fetches `get_company_overview` for each (parallel `Promise.all`). Produces comparison table: P/E, Forward P/E, P/S, EPS growth, profit margin, dividend yield, beta. Highlights cheapest/most expensive on each metric.

---

### 3.9 FinRobot (6.5k stars)

**What they do well:** Financial Chain-of-Thought (FinCoT) prompting — structured prompts that force the model through specific analytical steps before conclusions.

**What to steal:**

| Idea | Relevance | Why |
|------|-----------|-----|
| Chain-of-thought analytical framework in system prompt | **HIGH** | Vantage says "chain tools" but doesn't enforce structured reasoning steps. FinCoT adds explicit checkpoints. Free improvement — zero code changes. |

**How to apply to Vantage:**

**Modify `src/system-prompt.ts` — add structured framework:**

```
## Analytical Framework (follow for any stock analysis)

Step 1 — DATA COLLECTION: Fetch quote, fundamentals, technicals, sentiment.
  Do not proceed until all data is gathered.

Step 2 — QUANTITATIVE SCREEN: Check P/E vs sector, revenue growth trend (3yr),
  margin trend, RSI position, relative to 52-week range.
  Output: PASS/FAIL on each.

Step 3 — QUALITATIVE ASSESSMENT: Earnings surprise trend, sentiment divergence
  from price action, macro headwinds/tailwinds.

Step 4 — RISK CHECK: Volatility, max drawdown history, VaR.
  Flag if any metric is in the danger zone.

Step 5 — SYNTHESIS: Only now form your thesis. State reasoning chain explicitly:
  "Because [data point] + [data point], I conclude [thesis]."
```

Zero infrastructure cost — purely prompt engineering.

---

### 3.10 ATLAS (1.3k stars)

**What they do well:** Self-improving agents. Prompts scored against real outcomes. Worst-performing prompt rewritten. Darwinian weighting (0.3 to 2.5, adjusted daily). Git-based version control for prompt evolution.

**What to steal:**

| Idea | Relevance | Why |
|------|-----------|-----|
| Outcome tracking and prompt scoring | **MEDIUM** | Track recommendations, later check if price moved in predicted direction. Builds a track record. |
| Analysis quality scoring rubric | **MEDIUM** | Agent scores own analysis on data completeness, logical consistency, risk acknowledgment. |

**How to apply to Vantage:**

**Prediction tracking — new `src/tools/portfolio/predictions.ts`:**

Parameters: `action` (record/check), `symbol`, `prediction` (bullish/bearish/neutral), `target_price` (optional), `timeframe` (e.g., "30d")

Record action saves to `~/.vantage/predictions.json`:
```json
{
  "symbol": "AAPL",
  "prediction": "bullish",
  "priceAtPrediction": 178.50,
  "targetPrice": 195.00,
  "date": "2026-03-29",
  "expiresAt": "2026-04-28"
}
```

Check action fetches current prices, computes directional accuracy:
"Out of 20 analyses, 14 were directionally correct (70%)"

---

### 3.11-3.14 Quick Takes

| Project | Stealable Idea | Relevance | Notes |
|---------|---------------|-----------|-------|
| **OpenAlice** | Watchlist config file | **MEDIUM** | `~/.vantage/watchlist.json` with alert levels. Same persistence pattern as portfolio. |
| **Polymarket Agents** | Event-driven analysis (earnings dates, FOMC) | **MEDIUM** | Economic calendar tool would add context. Hard to find free API. |
| **Financial Datasets MCP** | MCP server exposure of tools | **LOW** | Interesting for interop but no clear user benefit today. |
| **Microsoft MarS** | Order-level market simulation | **LOW** | Computationally intensive, not relevant to advisory role. |
| **FinMem** | Layered memory architecture | **LOW** | Interesting concept but Vantage has no persistent memory system to layer on. |
| **AgenticTrading** | MCP/A2A protocol integration | **LOW** | Protocol-forward but premature for Vantage's current stage. |

---

## 4. Cross-Cutting Patterns

These gaps appear across multiple competitors — things almost every serious project has that Vantage lacks:

### 4.1 Balance Sheet and Cash Flow Data

**Appears in:** OpenBB, Anthropic plugins, Dexter, FinRobot

**The problem:** Vantage's `getFinancials` only fetches income statements. The `FinancialStatement` type has fields for `totalAssets`, `totalLiabilities`, `totalEquity`, `operatingCashFlow`, and `freeCashFlow` — but they're all hardcoded to 0.

**The fix:** Add `BALANCE_SHEET` and `CASH_FLOW` API calls to `src/providers/alpha-vantage.ts`. These are existing Alpha Vantage endpoints with the same rate limits. The types already support the data.

### 4.2 Volume Analysis

**Appears in:** FinRL, TradingAgents, OpenBB

**The problem:** Vantage fetches volume in `getHistory` but the technical indicators tool completely ignores it. Volume confirmation is a fundamental concept.

**The fix:** Add to `src/tools/technical/indicators.ts`:
- **OBV (On-Balance Volume):** Cumulative volume — add on up-days, subtract on down-days
- **VWAP:** `sum(price * volume) / sum(volume)`
- **Volume trend signal:** "Volume expanding on advance" or "Volume declining on rally"

### 4.3 Correlation Analysis

**Appears in:** AI Hedge Fund, FinRL, Anthropic plugins

**The problem:** No inter-asset correlation analysis. Highly correlated positions are effectively one position from a risk perspective.

**The fix:** Fetch history for two symbols, compute Pearson correlation of daily returns. For portfolio view: correlation matrix of all positions. Flag highly correlated holdings as concentration risk.

---

## 5. Prioritized Feature Recommendations

### Tier 1: High Impact, Fits Naturally

These require minimal new infrastructure, use free APIs, and directly improve the core analysis experience.

| # | Feature | Source | Effort | Files to Modify |
|---|---------|--------|--------|-----------------|
| 1 | **Named investor personas** | AI Hedge Fund | ~1-2hr | `src/analysts/orchestrator.ts` |
| 2 | **Self-validation loop** | Dexter | ~30min | `src/analysts/orchestrator.ts` |
| 3 | **Structured chain-of-thought** | FinRobot | ~30min | `src/system-prompt.ts` |
| 4 | **Complete balance sheet + cash flow data** | OpenBB, Anthropic | ~2hr | `src/providers/alpha-vantage.ts` |
| 5 | **DCF valuation model** | Anthropic plugins | ~3-4hr | New `src/tools/fundamentals/dcf.ts` |
| 6 | **Comparable company analysis** | Anthropic plugins | ~2-3hr | New `src/tools/fundamentals/comps.ts` |
| 7 | **Quantitative sentiment scoring** | FinGPT | ~1-2hr | `src/providers/reddit.ts`, `src/types/sentiment.ts` |
| 8 | **Consensus voting format** | AI Hedge Fund | ~1-2hr | `src/analysts/orchestrator.ts` |

**Why these are Tier 1:**
- Items 1, 2, 3, 8 are prompt-only changes — zero new files, zero new APIs
- Items 4 is fixing existing broken data (fields return 0)
- Items 5, 6 are the most-requested valuation methods in finance, computed locally
- Item 7 turns qualitative data into quantitative — a fundamental improvement

### Tier 2: Medium Impact, Worth Considering

| # | Feature | Source | Effort | New API? |
|---|---------|--------|--------|----------|
| 9 | **SEC EDGAR filing fetcher** | OpenBB, Dexter | ~4-6hr | Yes (free, no key) |
| 10 | **Simple backtesting** | FinRL | ~4-5hr | No (reuses existing functions) |
| 11 | **Watchlist management** | OpenAlice | ~2-3hr | No (JSON persistence) |
| 12 | **Volume indicators (OBV, VWAP)** | Multiple | ~1-2hr | No (data already fetched) |
| 13 | **Portfolio correlation matrix** | AI Hedge Fund | ~3-4hr | No (local math) |
| 14 | **Options chain data** | OpenBB | ~4-5hr | Yes (Yahoo, free) |
| 15 | **Prediction tracking** | ATLAS | ~3-4hr | No (JSON persistence) |

**Why these are Tier 2:** Each adds real value but either requires a new data source, more complex logic, or addresses a narrower use case than Tier 1.

### Tier 3: Interesting but Deprioritize

| # | Feature | Source | Why Deprioritize |
|---|---------|--------|-----------------|
| 16 | **Debate rounds between analysts** | TradingAgents | Doubles token cost. Validation loop (item 2) captures 80% of value at 20% of cost. |
| 17 | **Economic calendar / event data** | Polymarket | Hard to find reliable free API. |
| 18 | **Insider trading (Form 4)** | OpenBB | Complex XML parsing. Revisit after SEC EDGAR (item 9) is in place. |
| 19 | **Portfolio rebalancing** | Anthropic plugins | Requires UX for target allocations. More useful after portfolio features mature. |
| 20 | **MCP server exposure** | Financial Datasets MCP | No clear user benefit today. Revisit when MCP ecosystem matures. |

---

## 6. What NOT to Build

Ideas that appear frequently in competitors but should be explicitly excluded:

| Idea | Why Not |
|------|---------|
| **Live trading execution** | Vantage is advisory. Execution creates liability and complexity that dwarfs the benefit. |
| **Reinforcement learning models** | Requires GPU infra, training pipelines, ongoing model management. Not feasible in TypeScript. |
| **Fine-tuned financial models** | Same infrastructure burden. Gemini with good prompting is the right approach. |
| **100+ data integrations** | Breadth for breadth's sake adds maintenance. Focus on 5-8 high-value sources covering 95% of retail needs. |
| **Web scraping for news** | Fragile, legally gray. Reddit/FRED/SEC already provide sufficient signal. |
| **Order-level market simulation** | Computationally intensive, academic exercise, not relevant to advisory role. |

---

## 7. Implementation Sequencing

### Phase 1: Prompt-Only Improvements (no new files)

**What:** Named personas, chain-of-thought, self-validation, consensus voting
**Files:** `src/analysts/orchestrator.ts`, `src/system-prompt.ts`
**Impact:** Transforms analysis quality with zero new infrastructure

### Phase 2: Data Completeness (fix existing gaps)

**What:** Balance sheet + cash flow data, quantitative sentiment scoring, volume indicators
**Files:** `src/providers/alpha-vantage.ts`, `src/providers/reddit.ts`, `src/tools/technical/indicators.ts`
**Impact:** Makes existing tools actually deliver what they claim to provide

### Phase 3: New Analytical Tools

**What:** DCF valuation, comparable company analysis, watchlist, correlation matrix
**Files:** New tools in `src/tools/fundamentals/` and `src/tools/portfolio/`
**Impact:** Adds the valuation and risk management capabilities that differentiate serious analysis from basic data display

### Phase 4: New Data Sources

**What:** SEC EDGAR, options chain, backtesting, prediction tracking
**Files:** New providers and tools
**Impact:** Expands data coverage to institutional-grade sources

---

## 8. API Endpoints Reference

Free APIs relevant to recommended features:

| Feature | API | Endpoint | Auth |
|---------|-----|----------|------|
| Balance Sheet | Alpha Vantage | `function=BALANCE_SHEET&symbol={sym}` | API key (free tier) |
| Cash Flow | Alpha Vantage | `function=CASH_FLOW&symbol={sym}` | API key (free tier) |
| SEC Filing Search | SEC EDGAR | `https://efts.sec.gov/LATEST/search-index?q={query}&forms=10-K,10-Q,8-K` | None (User-Agent required) |
| SEC Filing Text | SEC EDGAR | `https://www.sec.gov/Archives/edgar/data/{cik}/{accession}` | None |
| Options Chain | Yahoo Finance | `https://query1.finance.yahoo.com/v7/finance/options/{symbol}` | None |
| Insider Transactions | SEC EDGAR | Form 4 via EDGAR full-text search | None |

---

## Appendix: Key Algorithms to Implement

### DCF Intrinsic Value

```
FCF_projected[year] = FCF_current * (1 + growth_rate) ^ year
Terminal_Value = FCF_projected[final] * (1 + terminal_growth) / (discount_rate - terminal_growth)
PV[year] = FCF_projected[year] / (1 + discount_rate) ^ year
PV_terminal = Terminal_Value / (1 + discount_rate) ^ final_year
Enterprise_Value = sum(PV[1..n]) + PV_terminal
Equity_Value = Enterprise_Value - Net_Debt
Intrinsic_Per_Share = Equity_Value / Shares_Outstanding
Margin_of_Safety = (Intrinsic_Per_Share - Current_Price) / Intrinsic_Per_Share
```

### On-Balance Volume (OBV)

```
For each day:
  if close > prev_close: OBV += volume
  if close < prev_close: OBV -= volume
  if close == prev_close: OBV unchanged
```

### VWAP (Volume-Weighted Average Price)

```
VWAP = sum(typical_price * volume) / sum(volume)
where typical_price = (high + low + close) / 3
```

### Pearson Correlation (for portfolio positions)

```
r = cov(returns_A, returns_B) / (std(returns_A) * std(returns_B))
Range: -1 (perfect negative) to +1 (perfect positive)
Flag: |r| > 0.7 = high correlation = concentration risk
```

### Keyword Sentiment Score

```
bullish_count = count of BULLISH_TERMS in text
bearish_count = count of BEARISH_TERMS in text
score = (bullish_count - bearish_count) / (bullish_count + bearish_count)
Range: -1.0 (fully bearish) to +1.0 (fully bullish)
```
