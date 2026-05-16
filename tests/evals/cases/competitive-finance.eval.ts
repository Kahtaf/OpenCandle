import { describe, it } from "vitest";
import { competitiveFinanceCasesForTier } from "../competitive-finance-cases.js";
import { registerEvalSuite } from "../eval-suite.js";

process.env.OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS ??= "30000";

const casesToRun = competitiveFinanceCasesForTier(process.env.EVAL_TIER);

if (casesToRun.length > 0) {
  registerEvalSuite("Competitive Finance Evals", casesToRun, { threshold: 0.75, timeout: 600_000 });
} else {
  describe("Competitive Finance Evals", () => {
    it.skip("skipped — run with EVAL_TIER=competitive", () => {});
  });
}
