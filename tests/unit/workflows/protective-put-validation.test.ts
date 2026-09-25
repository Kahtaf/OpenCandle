import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { OptionsScreenerSlots, SlotResolution } from "../../../src/routing/types.js";
import { buildOptionsScreenerWorkflowDefinition } from "../../../src/workflows/options-screener.js";
import { protectivePutCoverage } from "../../../src/workflows/protective-put-output-validation.js";
import { evaluateFinalAnswerAssertion } from "../../evals/prompt-policy-assertions.js";
import type { EvalTrace } from "../../evals/types.js";

function workflow(shares = 375, strategy = "protective_put") {
  return buildOptionsScreenerWorkflowDefinition({
    resolved: {
      symbol: "TEST",
      direction: "bearish",
      optionStrategy: strategy,
      shareQuantity: shares,
      dteTarget: "25_to_45_days",
      objective: "balanced_leverage_and_probability",
      moneynessPreference: "atm_to_slightly_otm",
      liquidityMinimum: "high_open_interest_and_tight_spread",
    },
    sources: {},
    defaultsUsed: [],
    missingRequired: [],
  } as SlotResolution<OptionsScreenerSlots>);
}
const coverage = `Standard-contract illustration only: assuming 100 shares per put contract; verify the actual multiplier with your broker.
Owned position: 375 shares.
| Put contracts | Covered shares | Uncovered shares | Excess shares |
| --- | --- | --- | --- |
| 3 puts | 300 shares | 75 shares | 0 shares |
| 4 puts | 400 shares | 0 shares | 25 shares |`;
const unavailable = "Premium percentage unavailable: no verified executable premium or stock mark.";
const costs = `| Option | Put contracts | Premium per share | Total premium | Stock mark | Premium % of owned position |
| --- | --- | --- | --- | --- | --- |
| Put A | 4 puts | $2.50 | $1,000.00 | $120.00 | 2.22% |`;

function validate(text: string, shares = 375) {
  const validation = workflow(shares).steps[1].outputValidation;
  expect(
    validation,
    "protective-put synthesis must enforce owned versus covered quantities",
  ).toBeDefined();
  return validation?.validate(text) ?? [];
}

describe("protective-put workflow financial contract", () => {
  it("rejects the actual live answer with unexplained rounding and the wrong premium denominator", () => {
    const answer = readFileSync(
      "tests/fixtures/workflows/protective-put-missing-coverage.txt",
      "utf8",
    );
    expect(validate(answer, 450).length).toBeGreaterThan(0);
  });
  it("accepts correct whole-contract choices with explicit unavailable pricing", () => {
    expect(validate(`${coverage}\n${unavailable}`)).toEqual([]);
  });
  it("rejects incorrect residual arithmetic and a missing alternative", () => {
    expect(
      validate(`${coverage.replace("| 75 shares |", "| 25 shares |")}\n${unavailable}`).length,
    ).toBeGreaterThan(0);
    expect(
      validate(`${coverage.split("\n").slice(0, -1).join("\n")}\n${unavailable}`).length,
    ).toBeGreaterThan(0);
  });
  it("uses actual owned shares for premium percentage and validates every displayed cost row", () => {
    expect(validate(`${coverage}\n\n${costs}`)).toEqual([]);
    expect(validate(`${coverage}\n\n${costs.replace("2.22%", "2.08%")}`).length).toBeGreaterThan(0);
    expect(
      validate(`${coverage}\n\n${costs}\n| Put B | 3 puts | $2.50 | $750.00 | $120.00 | 9.00% |`)
        .length,
    ).toBeGreaterThan(0);
  });
  it("rejects fractional contracts, invalid marks, and inconsistent total premium", () => {
    expect(validate(`${coverage}\n\n${costs}`)).toEqual([]);
    for (const invalid of [
      costs.replace("4 puts", "3.75 puts"),
      costs.replace("$120.00", "$0.00"),
      costs.replace("$1,000.00", "$1,100.00"),
      costs.replace("$120.00", "$1,20.00"),
    ]) {
      expect(validate(`${coverage}\n\n${invalid}`).length).toBeGreaterThan(0);
    }
  });
  it("does not mistake IV or unrelated percentages for premium calculations", () => {
    expect(
      validate(`${coverage}\n${unavailable}\nIV is 32%; the position could lose 15%.`),
    ).toEqual([]);
    expect(
      validate(`${coverage}\n${unavailable}\nPremium is 2.08% of the position.`).length,
    ).toBeGreaterThan(0);
  });
  it("accepts the required sizing table in the unchanged competitive checker", () => {
    const answer = `Standard-contract illustration: assuming 100 shares per put contract.
Owned position: 450 shares.
| Put contracts | Covered shares | Uncovered shares | Excess shares |
| --- | --- | --- | --- |
| 4 puts | 400 shares | 50 shares | 0 shares |
| 5 puts | 500 shares | 0 shares | 50 shares |
${unavailable}`;
    expect(validate(answer, 450)).toEqual([]);
    const trace: EvalTrace = {
      prompt: "",
      text: answer,
      classification: {
        workflow: "options_screener",
        confidence: 1,
        tier: "rule",
        entities: { symbols: [] },
      },
      toolCalls: [],
      askUserTranscript: [],
    };
    expect(
      evaluateFinalAnswerAssertion(
        "sizes hedge from 450 shares into 4 puts plus residual 50 shares or explicitly explains rounding",
        trace,
      ).passed,
    ).toBe(true);
  });
  it("handles exact and fractional stock positions without inventing fractional option contracts", () => {
    expect(protectivePutCoverage(200)).toEqual([
      { contracts: 2, covered: 200, uncovered: 0, excess: 0 },
    ]);
    expect(protectivePutCoverage(25.5)).toEqual([
      { contracts: 0, covered: 0, uncovered: 25.5, excess: 0 },
      { contracts: 1, covered: 100, uncovered: 0, excess: 74.5 },
    ]);
    expect(() => protectivePutCoverage(Number.NaN)).toThrow("positive and finite");
    expect(() => protectivePutCoverage(0)).toThrow("positive and finite");
  });
  it("shares computed context across both prompts and keeps unrelated strategies unchanged", () => {
    for (const step of workflow().steps) {
      expect(step.prompt).toContain("375 shares");
      expect(step.prompt).toContain("75 shares");
      expect(step.prompt).toContain("25 shares");
    }
    expect(workflow(375, "covered_call").steps[1].outputValidation).toBeUndefined();
  });
});
