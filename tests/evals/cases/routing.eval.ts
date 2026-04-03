import type { EvalCase } from "../types.js";
import { registerEvalSuite } from "../eval-suite.js";

/**
 * Routing eval cases — tests that the agent calls the right tools for direct prompts.
 *
 * Note: Prompts that trigger workflow dispatch (portfolio_builder, options_screener,
 * compare_assets) are excluded because the harness captures the initial agent turn only,
 * not the async workflow execution. These belong in multi-turn.eval.ts once the harness
 * supports workflow tracing.
 */
const routingCases: EvalCase[] = [
  {
    name: "stock-quote",
    tier: "always",
    prompt: "What's AAPL trading at?",
    assertions: {
      requiredTools: ["get_stock_quote"],
      requiredArgs: { get_stock_quote: { symbol: "AAPL" } },
    },
  },
  {
    name: "technicals",
    tier: "always",
    prompt: "Run technicals on SPY",
    assertions: {
      requiredTools: ["get_technical_indicators"],
      requiredArgs: { get_technical_indicators: { symbol: "SPY" } },
    },
  },
  {
    name: "backtest",
    tier: "always",
    prompt: "Backtest SMA crossover on SPY 2 years",
    assertions: {
      requiredTools: ["backtest_strategy"],
    },
  },
  {
    name: "sec-filings",
    tier: "always",
    prompt: "Pull up recent 10-K and 10-Q filings from SEC EDGAR for Apple Inc",
    assertions: {
      requiredTools: ["get_sec_filings"],
    },
  },
  {
    name: "fear-greed",
    tier: "always",
    prompt: "Show me the current Fear and Greed index",
    assertions: {
      requiredTools: ["get_fear_greed"],
    },
  },
  {
    name: "macro-gdp",
    tier: "always",
    prompt: "What's the current GDP growth rate?",
    assertions: {
      requiredTools: ["get_economic_data"],
    },
  },
  {
    name: "dcf-valuation",
    tier: "always",
    prompt: "Run a DCF on AAPL",
    assertions: {
      requiredTools: ["compute_dcf"],
    },
  },
];

registerEvalSuite("Routing Evals (Always-tier)", routingCases, { threshold: 0.8 });
