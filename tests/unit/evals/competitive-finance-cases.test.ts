import { describe, expect, it } from "vitest";
import {
  competitiveFinanceCases,
  competitiveFinanceCasesForTier,
} from "../../evals/competitive-finance-cases.js";

describe("competitive finance eval cases", () => {
  it("keeps the reusable competitive benchmark out of default eval runs", () => {
    expect(competitiveFinanceCasesForTier(undefined)).toEqual([]);
    expect(competitiveFinanceCasesForTier("usually")).toEqual([]);
    expect(competitiveFinanceCasesForTier("competitive")).toEqual(competitiveFinanceCases);
  });

  it("defines reusable OC-vs-generic-agent prompts with scoring assertions", () => {
    expect(competitiveFinanceCases.length).toBeGreaterThanOrEqual(6);

    for (const evalCase of competitiveFinanceCases) {
      expect(evalCase.tier).toBe("usually");
      expect(evalCase.prompt.length).toBeGreaterThan(20);
      expect(evalCase.assertions.expectedWorkflow).toBeDefined();
      expect(evalCase.assertions.requiredTools?.length).toBeGreaterThan(0);
      expect(evalCase.competitive.genericAgentLimitation.length).toBeGreaterThan(20);
      expect(evalCase.competitive.openCandleAdvantage.length).toBeGreaterThan(20);
      expect(evalCase.competitive.evidenceExpectation.length).toBeGreaterThan(20);
    }
  });
});
