import { describe, it } from "vitest";
import { COMPETITIVE_STATE_FIXTURE } from "../competitive-finance.js";
import { registerEvalSuite } from "../eval-suite.js";
import type { EvalCase } from "../types.js";

const savedMarketStateCases: EvalCase[] = [
  {
    name: "saved-state-portfolio-rate-exposure-review",
    tier: "usually",
    prompt: "is my current portfolio too exposed if rates stay high?",
    savedMarketStateFixture: COMPETITIVE_STATE_FIXTURE,
    assertions: {
      expectedWorkflow: "general_finance_qa",
      savedMarketStateFidelity: {
        forbiddenWorkflow: "portfolio_builder",
        expectedTaskFamily: "portfolio_review",
        requiredSummarySymbols: ["SPY", "AAPL", "XLE"],
        requiredSummaryValues: ["60", "$480", "40", "$175", "100", "$85"],
        requiredFinalValues: ["SPY", "60", "$480", "AAPL", "40", "$175", "XLE", "100", "$85"],
      },
      responseNotContains: [/build (?:you|a) (?:new )?portfolio/i],
    },
  },
  {
    name: "saved-state-spy-cost-basis-lot",
    tier: "usually",
    prompt: "what's my cost basis on my SPY lot?",
    savedMarketStateFixture: COMPETITIVE_STATE_FIXTURE,
    assertions: {
      expectedWorkflow: "general_finance_qa",
      savedMarketStateFidelity: {
        forbiddenWorkflow: "portfolio_builder",
        expectedTaskFamily: "portfolio_review",
        requiredSummarySymbols: ["SPY"],
        requiredSummaryValues: ["60", "$480", "$28,800"],
        requiredFinalValues: ["SPY", "60", "$480", "$28,800"],
      },
    },
  },
];

const runKnownFailE2 =
  process.env.EVAL_TIER === "usually" && process.env.OPENCANDLE_EVAL_KNOWN_FAIL_E2 === "1";

if (runKnownFailE2) {
  registerEvalSuite("Saved Market-State Fidelity Evals (Known-fail E2)", savedMarketStateCases, {
    threshold: 1,
    timeout: 600_000,
  });
} else {
  describe("Saved Market-State Fidelity Evals (Known-fail E2)", () => {
    // PROMOTE: Remove OPENCANDLE_EVAL_KNOWN_FAIL_E2 once opencandle-route-context carries the
    // saved market-state summary and these cases pass against the live harness.
    it.skip("KNOWN-FAIL E2: opt-in with EVAL_TIER=usually OPENCANDLE_EVAL_KNOWN_FAIL_E2=1", () => {});
  });
}
