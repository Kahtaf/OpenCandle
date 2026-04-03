import type { EvalCase } from "../types.js";
import { registerEvalSuite } from "../eval-suite.js";

const multiTurnCases: EvalCase[] = [
  {
    name: "portfolio-builder-conservative",
    tier: "always",
    prompt: "Build me a portfolio with $50k",
    answers: ["conservative", "10 years", "no", "no", "growth"],
    assertions: {
      expectedWorkflow: "portfolio_builder",
      requiredTools: ["get_stock_quote"],
      forbiddenTools: ["get_option_chain"],
    },
  },
  {
    name: "portfolio-builder-aggressive",
    tier: "always",
    prompt: "Build me a portfolio with $50k",
    answers: ["aggressive", "3 years", "no", "no", "growth"],
    assertions: {
      expectedWorkflow: "portfolio_builder",
      requiredTools: ["get_stock_quote"],
    },
  },
  {
    name: "options-screener",
    tier: "always",
    prompt: "Find covered call candidates for AAPL",
    assertions: {
      expectedWorkflow: "options_screener",
      requiredTools: ["get_option_chain"],
    },
  },
  {
    name: "compare-assets",
    tier: "always",
    prompt: "Compare AAPL and MSFT",
    assertions: {
      expectedWorkflow: "compare_assets",
      requiredTools: ["get_stock_quote"],
      requiredArgs: {
        get_stock_quote: { symbol: "AAPL" },
      },
    },
  },
  {
    name: "comprehensive-analysis",
    tier: "usually",
    prompt: "analyze NVDA",
    assertions: {
      expectedWorkflow: "single_asset_analysis",
      requiredTools: ["get_stock_quote", "get_company_overview"],
      dataFaithfulness: true,
    },
  },
];

registerEvalSuite("Multi-turn Workflow Evals", multiTurnCases, { threshold: 0.7 });
