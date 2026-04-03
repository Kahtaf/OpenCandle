import type { EvalCase } from "../types.js";
import { registerEvalSuite } from "../eval-suite.js";

const faithfulnessCases: EvalCase[] = [
  {
    name: "quote-accuracy",
    tier: "always",
    prompt: "What's the current price of AAPL?",
    assertions: {
      requiredTools: ["get_stock_quote"],
      dataFaithfulness: true,
    },
  },
  {
    name: "ratio-accuracy",
    tier: "always",
    prompt: "Give me the key fundamentals for MSFT including valuation ratios and market cap.",
    assertions: {
      requiredTools: ["get_company_overview"],
      dataFaithfulness: true,
    },
  },
  {
    name: "backtest-metrics",
    tier: "always",
    prompt: "Backtest a simple moving average crossover on SPY over 1 year. What was the total return and max drawdown?",
    assertions: {
      requiredTools: ["backtest_strategy"],
      dataFaithfulness: true,
    },
  },
];

registerEvalSuite("Data Faithfulness Evals (Always-tier)", faithfulnessCases, { threshold: 0.8 });
