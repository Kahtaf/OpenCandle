import type { EvalCase } from "../types.js";
import { registerEvalSuite } from "../eval-suite.js";

/**
 * Eval cases for the adversarial bull/bear debate feature.
 * Verifies debate steps appear in trace, synthesis resolves tension,
 * and reversal condition is present.
 *
 * Note: expectedWorkflow is omitted because the extension intercepts
 * "analyze X" before the router classifies it.
 */
const debateCases: EvalCase[] = [
  {
    name: "comprehensive-analysis-with-debate",
    tier: "usually",
    prompt: "analyze AAPL",
    assertions: {
      requiredTools: ["get_stock_quote"],
      dataFaithfulness: true,
      responseContains: [
        /BULL THESIS:/i,
        /BEAR THESIS:/i,
        /VERDICT:/i,
        /DEBATE WINNER:/i,
        /REVERSAL CONDITION:/i,
      ],
      rubric: [
        "data_collection",
        "reasoning_chain",
        "risk_check",
        "actionable_conclusion",
      ],
    },
  },
  {
    name: "debate-rebuttal-skips-on-consensus",
    tier: "usually",
    prompt: "analyze MSFT",
    assertions: {
      requiredTools: ["get_stock_quote"],
      responseContains: [
        /BULL THESIS:/i,
        /BEAR THESIS:/i,
        /VERDICT:/i,
      ],
      rubric: [
        "reasoning_chain",
        "actionable_conclusion",
      ],
    },
  },
];

import { describe, it } from "vitest";

const tier = process.env.EVAL_TIER;
const casesToRun = tier === "usually" ? debateCases : debateCases.filter((c) => c.tier === "always");

if (casesToRun.length > 0) {
  registerEvalSuite("Debate Evals (Usually-tier)", casesToRun, { threshold: 0.6, timeout: 600_000 });
} else {
  describe("Debate Evals (Usually-tier)", () => {
    it.skip("skipped — run with EVAL_TIER=usually", () => {});
  });
}
