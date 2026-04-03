import type { EvalCase } from "../types.js";
import { registerEvalSuite } from "../eval-suite.js";

/**
 * Usually-tier eval cases for analysis quality and E2E workflows.
 * These use LLM-as-judge and run nightly/on-demand, not in CI.
 */
const qualityCases: EvalCase[] = [
  {
    name: "analysis-depth",
    tier: "usually",
    prompt: "Give me a comprehensive analysis of NVDA including fundamentals, technicals, and sentiment.",
    assertions: {
      requiredTools: ["get_stock_quote", "get_company_overview", "get_technical_indicators"],
      dataFaithfulness: true,
      rubric: [
        "data_collection",
        "quantitative_screen",
        "risk_check",
        "reasoning_chain",
        "actionable_conclusion",
      ],
    },
  },
  {
    name: "reasoning-chain",
    tier: "usually",
    prompt: "Should I invest in AAPL right now? Walk me through your analysis.",
    assertions: {
      requiredTools: ["get_stock_quote"],
      rubric: [
        "reasoning_chain",
        "actionable_conclusion",
        "risk_check",
      ],
    },
  },
  {
    name: "balanced-perspective",
    tier: "usually",
    prompt: "Give me the bull and bear case for TSLA.",
    assertions: {
      requiredTools: ["get_stock_quote"],
      rubric: [
        "data_collection",
        "risk_check",
        "reasoning_chain",
      ],
    },
  },
];

import { describe, it } from "vitest";

const tier = process.env.EVAL_TIER;
const casesToRun = tier === "usually" ? qualityCases : qualityCases.filter((c) => c.tier === "always");

if (casesToRun.length > 0) {
  registerEvalSuite("Quality Evals (Usually-tier)", casesToRun, { threshold: 0.6 });
} else {
  describe("Quality Evals (Usually-tier)", () => {
    it.skip("skipped — run with EVAL_TIER=usually", () => {});
  });
}
