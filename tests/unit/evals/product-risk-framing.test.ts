import { describe, expect, it } from "vitest";
import { PRODUCT_EVAL_CASES } from "../../evals/product/cases.js";
import { hasRiskFraming } from "../../evals/product/risk-framing.js";
import { scoreProductEvalCase } from "../../evals/product/scorer.js";
import type { EvalTrace } from "../../evals/types.js";

// Excerpt of the preserved canonical education-pe-ratio answer
// (validation-output/eval-diagnostics/2026-09-25T15-20-30-397Z_education-pe-ratio_*.json).
// It frames P/E limitations under "Where it misleads" but never uses the bare
// words "risk", "downside", or "caveat".
const PE_ANSWER_EXCERPT = [
  "Bottom line: The Price-to-Earnings (P/E) ratio is a fundamental valuation metric that helps investors understand how much they are paying for a company's earnings.",
  "*   **Forward P/E** uses estimated earnings for the next 12 months. It reflects market expectations for future performance but relies on projections which can be inaccurate.",
  "### Where it misleads",
  "*   **Cyclical Companies:** A P/E ratio based on peak earnings might look artificially low, while one based on trough earnings might look artificially high.",
  "*   **Balance Sheet Differences:** P/E doesn't account for a company's debt load. A company with a lower P/E but significant debt might be riskier than one with a higher P/E but a strong balance sheet.",
  "*   Am I using P/E as a screening tool to ask further questions, not as a definitive verdict?",
].join("\n");

// Real sentences from previously passing saved product-eval answers
// (tests/evals/runs/2026-09-25T04-52-17-003Z_product-evals.json).
const PRIOR_PASSING_EXCERPTS = [
  "**Invalidation Level:** This bull thesis is invalidated on a daily close below $348",
  "**Risk Caveats:**",
  "The choice between them hinges on the specific nature of the desired hedge and risk tolerance",
  "Even with a favorable rate environment, a growth stock may face competitive pressures, execution risks, or other company-specific challenges",
  "| Max Drawdown         | 9.1% |",
];

describe("hasRiskFraming", () => {
  it("accepts the preserved P/E answer's misleading/limitation framing", () => {
    expect(hasRiskFraming(PE_ANSWER_EXCERPT)).toBe(true);
  });

  it.each(PRIOR_PASSING_EXCERPTS)("accepts a previously passing answer: %s", (text) => {
    expect(hasRiskFraming(text)).toBe(true);
  });

  it.each([
    "Leveraged ETFs are riskier than the underlying index over long holding periods.",
    "The riskiest part of the plan is concentration in one sector.",
    "Small caps are risky when credit tightens.",
    "The main limitations of this metric are listed below.",
    "Forward estimates can be inaccurate when guidance changes.",
    "Relying on one ratio can mislead you about quality.",
    "This shortcut is misleading for cyclical businesses.",
    "Treat the read as uncertain until earnings confirm it.",
    "The key uncertainty is the timing of rate cuts.",
    "The tradeoff is lower yield for more stability.",
    "Investors can suffer losses if the thesis breaks.",
    "The thesis is invalidated below support.",
    "Downside is limited by the collar.",
    "One caveat applies to the forward multiple.",
  ])("accepts downside, uncertainty, invalidation, limitation, or tradeoff framing: %s", (text) => {
    expect(hasRiskFraming(text)).toBe(true);
  });

  it.each([
    "",
    "The P/E ratio divides share price by earnings per share. Investors use it to compare companies.",
    "This is risk-free.",
    "This is a risk free return.",
    "There is no downside.",
    "No caveats apply.",
    "There are no caveats to this approach.",
    "Zero risk here.",
    "You can do it without any downside.",
    "Nothing to worry about with this plan.",
    "The strategy is not risky and returns are steady.",
    "This estimate is not inaccurate.",
    "There is no real risk and no meaningful downside in holding cash.",
  ])("rejects empty, non-risk, or only-negated risk language: %j", (text) => {
    expect(hasRiskFraming(text)).toBe(false);
  });

  it("accepts an unnegated marker even when another marker is negated", () => {
    expect(hasRiskFraming("There is no free lunch; the risk is a sharp drawdown.")).toBe(true);
    expect(hasRiskFraming("It is not risk-free, and the downside can be large.")).toBe(true);
  });

  it("does not treat an unrelated clause negation as denial of the risk", () => {
    expect(hasRiskFraming("Do not ignore the downside of concentration.")).toBe(true);
  });
});

describe("risk_framing dimension on the education P/E case", () => {
  const peCase = PRODUCT_EVAL_CASES.find((evalCase) => evalCase.id === "education-pe-ratio");
  if (!peCase) throw new Error("missing education-pe-ratio case");

  function trace(text: string): EvalTrace {
    return {
      prompt: peCase?.prompt ?? "",
      classification: {
        workflow: "general_finance_qa",
        confidence: 0.9,
        tier: "llm",
        entities: {},
      },
      toolCalls: [],
      askUserTranscript: [],
      text,
    } as EvalTrace;
  }

  function riskFramingPassed(text: string): boolean | undefined {
    return scoreProductEvalCase(peCase as NonNullable<typeof peCase>, trace(text)).dimensions.find(
      (dimension) => dimension.id === "risk_framing",
    )?.passed;
  }

  it("passes the preserved P/E answer that frames where the metric misleads", () => {
    expect(riskFramingPassed(PE_ANSWER_EXCERPT)).toBe(true);
  });

  it("fails a pure explanation or a negated-only risk statement", () => {
    expect(riskFramingPassed("P/E is price divided by earnings per share.")).toBe(false);
    expect(
      riskFramingPassed("P/E is price divided by earnings. There is no downside to using it."),
    ).toBe(false);
  });
});
