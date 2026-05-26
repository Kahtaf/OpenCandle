import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { EvalTrace } from "../../evals/types.js";
import { evaluateFinalAnswerAssertion } from "../../evals/prompt-policy-assertions.js";

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
    const manifest = JSON.parse(readFileSync("docs/internal/prompt-to-policy-migration-manifest.json", "utf-8")) as {
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
      trace("Budget can be relevant after this comparison, but this is not a construction request.", "compare_assets"),
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
