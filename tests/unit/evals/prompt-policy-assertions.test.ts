import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateFinalAnswerAssertion } from "../../evals/prompt-policy-assertions.js";
import type { EvalTrace } from "../../evals/types.js";

describe("prompt-policy final answer assertions", () => {
  it("fails unregistered hard assertions instead of treating them as passing evidence", () => {
    const result = evaluateFinalAnswerAssertion(
      "mentions net interest margin sensitivity",
      trace("Bottom line: rates matter."),
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("No deterministic checker registered");
  });

  it("registers deterministic checkers for every migration-manifest hard assertion", () => {
    const manifest = JSON.parse(
      readFileSync("docs/internal/prompt-to-policy-migration-manifest.json", "utf-8"),
    ) as {
      prompts: Array<{ expected: { finalAnswerHardAssertions?: string[] } }>;
    };
    const unregistered: string[] = [];
    const nonDeterministic: string[] = [];
    for (const prompt of manifest.prompts) {
      for (const assertion of prompt.expected.finalAnswerHardAssertions ?? []) {
        const result = evaluateFinalAnswerAssertion(assertion, trace(""));
        if (result.reason.startsWith("No deterministic checker")) unregistered.push(assertion);
        if (!result.deterministic) nonDeterministic.push(assertion);
      }
    }

    expect(unregistered).toEqual([]);
    expect(nonDeterministic).toEqual([]);
  });

  it("checks portfolio-construction routing without broad budget-text matching", () => {
    const result = evaluateFinalAnswerAssertion(
      "does not route as portfolio construction requiring a budget",
      trace(
        "Budget can be relevant after this comparison, but this is not a construction request.",
        "compare_assets",
      ),
    );

    expect(result.passed).toBe(true);
  });

  it("accepts ask_user ticker clarification for ambiguous ticker lookup assertions", () => {
    const result = evaluateFinalAnswerAssertion(
      "states the ticker could not be verified if lookup fails",
      {
        ...trace("Which company or ticker did you mean by ZZZZ?"),
        askUserTranscript: [
          { question: "Which company or ticker did you mean by ZZZZ?", answer: null },
        ],
      },
    );

    expect(result.passed).toBe(true);
  });

  it("does not treat unrelated ask_user prompts as ticker clarification", () => {
    const result = evaluateFinalAnswerAssertion(
      "states the ticker could not be verified if lookup fails",
      {
        ...trace("What is your portfolio budget?"),
        askUserTranscript: [{ question: "What is your portfolio budget?", answer: null }],
      },
    );

    expect(result.passed).toBe(false);
  });

  it("accepts explicit invalid-symbol disclosures that request the correct ticker", () => {
    const result = evaluateFinalAnswerAssertion(
      "states the ticker could not be verified if lookup fails",
      trace("ZZZZ appears to be an invalid symbol. Please provide the correct ticker."),
    );

    expect(result.passed).toBe(true);
  });

  it("accepts a verified non-company instrument that invalidates the earnings premise", () => {
    const result = evaluateFinalAnswerAssertion(
      "states the ticker could not be verified if lookup fails",
      trace(
        "ZZZZ resolves to a mutual fund, not an operating company, so the premise that it reports earnings tonight is invalid.",
      ),
    );

    expect(result.passed).toBe(true);
  });

  it("recognizes numeric DTE evidence inside the requested one-to-two-week window", () => {
    const result = evaluateFinalAnswerAssertion(
      "preserves requested 1-2 week DTE",
      trace("The available expirations are August 21 (8 DTE) and August 28 (15 DTE)."),
    );

    expect(result.passed).toBe(true);
  });

  it("recognizes a spelled-out seven-to-fourteen-day DTE window", () => {
    const result = evaluateFinalAnswerAssertion(
      "preserves requested 1-2 week DTE",
      trace("The DTE target is 7 to 14 days, and this expiry has 8 days to expiration."),
    );

    expect(result.passed).toBe(true);
  });

  it("recognizes a leading structural allocation read as a bottom-line portfolio read", () => {
    const result = evaluateFinalAnswerAssertion(
      "starts with a bottom-line structural portfolio read",
      trace(
        "Structural Allocation Read\nThe traditional 60/40 portfolio faces a challenging risk environment.",
      ),
    );

    expect(result.passed).toBe(true);
  });

  it("recognizes a leading portfolio outlook paragraph as the bottom-line read", () => {
    const result = evaluateFinalAnswerAssertion(
      "starts with a bottom-line structural portfolio read",
      trace(
        "The 60/40 portfolio faces a dynamic environment over the next year. Our read suggests moderate returns with higher volatility.",
      ),
    );

    expect(result.passed).toBe(true);
  });

  it("recognizes a brief evaluation lead-in followed by the structural portfolio read", () => {
    const result = evaluateFinalAnswerAssertion(
      "starts with a bottom-line structural portfolio read",
      trace(
        "Here is a critical evaluation of a 60/40 portfolio for the next year.\n\n### Structural Allocation Read\nThe allocation faces inflation and volatility risk.",
      ),
    );

    expect(result.passed).toBe(true);
  });

  it("recognizes an opening analyst commitment as a structural portfolio read", () => {
    const result = evaluateFinalAnswerAssertion(
      "starts with a bottom-line structural portfolio read",
      trace(
        "Analyst View: The 60/40 portfolio is likely to deliver modest returns with elevated volatility over the next year.\n\nCommitment: Keep the allocation, but expect a challenging risk environment.",
      ),
    );

    expect(result.passed).toBe(true);
  });
});

function trace(text: string, workflow = "general_finance_qa"): EvalTrace {
  return {
    prompt: "test prompt",
    classification: {
      workflow,
      confidence: 0.9,
      tier: "llm",
      entities: { symbols: [] },
    },
    router: { workflow },
    toolCalls: [],
    askUserTranscript: [],
    text,
  };
}
