import { describe, expect, it } from "vitest";
import {
  buildComparisonJudgePrompt,
  buildGenericAgentPrompt,
  buildPromptGenerationPrompt,
  parseComparisonJudgment,
  parseGeneratedPrompts,
} from "../../evals/competitive-finance.js";
import type { EvalTrace } from "../../evals/types.js";

describe("competitive finance benchmarking", () => {
  it("generates broad finance prompts without assuming OpenCandle should win", () => {
    const prompt = buildPromptGenerationPrompt({ count: 4, seed: "coverage-a" });

    expect(prompt).toContain("Generate 4 realistic finance prompts");
    expect(prompt).toContain("Do not bias toward prompts where OpenCandle obviously has a tool advantage");
    expect(prompt).toContain("A generic agent may be better");
    expect(prompt).toContain("what OpenCandle needs to improve");
  });

  it("parses generated prompt JSON from model output", () => {
    const prompts = parseGeneratedPrompts(`Here is JSON:
{
  "prompts": [
    {
      "id": "risk-explainer",
      "prompt": "Explain why duration matters for bond funds.",
      "topic": "fixed income",
      "complexity": "simple",
      "evaluationFocus": "clarity and correctness"
    }
  ]
}`);

    expect(prompts).toEqual([
      {
        id: "risk-explainer",
        prompt: "Explain why duration matters for bond funds.",
        topic: "fixed income",
        complexity: "simple",
        evaluationFocus: "clarity and correctness",
      },
    ]);
  });

  it("compares OpenCandle with a generic no-tool answer", () => {
    const trace: EvalTrace = {
      prompt: "What recent filings matter for COIN?",
      classification: {
        workflow: "general_finance_qa",
        confidence: 0.9,
        tier: "rule",
        entities: { symbols: ["COIN"] },
      },
      toolCalls: [{ name: "get_sec_filings", args: { symbol: "COIN" } }],
      askUserTranscript: [],
      text: "OpenCandle answer",
    };
    const judgePrompt = buildComparisonJudgePrompt({
      prompt: {
        id: "coin-filings",
        prompt: trace.prompt,
        topic: "filings",
        complexity: "moderate",
        evaluationFocus: "filing evidence and thesis impact",
      },
      openCandleTrace: trace,
      genericAnswer: "Generic answer",
    });

    expect(buildGenericAgentPrompt(trace.prompt)).toContain("without live tools");
    expect(judgePrompt).toContain("It is acceptable for the generic agent to win");
    expect(judgePrompt).toContain("get_sec_filings");
  });

  it("parses comparison judgments with OpenCandle improvement ideas", () => {
    const judgment = parseComparisonJudgment(`{
      "winner": "generic",
      "openCandleScore": 6,
      "genericScore": 8,
      "reason": "The generic answer explained the concept more clearly.",
      "openCandleDidBetter": ["used data"],
      "genericDidBetter": ["clearer explanation"],
      "openCandleImprovementIdeas": ["summarize before listing tool output"]
    }`);

    expect(judgment.winner).toBe("generic");
    expect(judgment.openCandleImprovementIdeas).toEqual(["summarize before listing tool output"]);
  });
});
