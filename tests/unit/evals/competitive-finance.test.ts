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
    const prompt = buildPromptGenerationPrompt({ count: 4, seed: "coverage-a", asOfDate: "2026-05-16" });

    expect(prompt).toContain("Generate 4 realistic finance prompts");
    expect(prompt).toContain("Current date for this benchmark run: 2026-05-16");
    expect(prompt).toContain("Do not bias toward prompts where OpenCandle obviously has a tool advantage");
    expect(prompt).toContain("Claude or Codex may be better");
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

  it("compares OpenCandle with Claude and Codex no-tool answers", () => {
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
      asOfDate: "2026-05-16",
      prompt: {
        id: "coin-filings",
        prompt: trace.prompt,
        topic: "filings",
        complexity: "moderate",
        evaluationFocus: "filing evidence and thesis impact",
      },
      openCandleTrace: trace,
      competitorAnswers: [
        {
          id: "claude",
          label: "Claude",
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          answer: "Claude answer",
        },
        {
          id: "codex",
          label: "Codex",
          provider: "openai-codex",
          model: "gpt-5.3-codex-spark",
          answer: "Codex answer",
        },
      ],
    });

    expect(buildGenericAgentPrompt(trace.prompt, { agentName: "Claude", asOfDate: "2026-05-16" })).toContain("Current date: 2026-05-16");
    expect(judgePrompt).toContain("Current date: 2026-05-16");
    expect(judgePrompt).toContain("Agent: Claude (claude, anthropic/claude-sonnet-4-5)");
    expect(judgePrompt).toContain("Agent: Codex (codex, openai-codex/gpt-5.3-codex-spark)");
    expect(judgePrompt).toContain("It is acceptable for Claude or Codex to win");
    expect(judgePrompt).toContain("Treat dates on or before the current date as current or historical");
    expect(judgePrompt).toContain("get_sec_filings");
  });

  it("parses comparison judgments with OpenCandle improvement ideas", () => {
    const judgment = parseComparisonJudgment(`{
      "winner": "generic",
      "openCandleScore": 6,
      "competitorScores": { "claude": 8, "codex": 7 },
      "reason": "The generic answer explained the concept more clearly.",
      "openCandleDidBetter": ["used data"],
      "competitorsDidBetter": { "claude": ["clearer explanation"], "codex": ["better structure"] },
      "openCandleImprovementIdeas": ["summarize before listing tool output"]
    }`);

    expect(judgment.winner).toBe("generic");
    expect(judgment.competitorScores).toEqual({ claude: 8, codex: 7 });
    expect(judgment.competitorsDidBetter).toEqual({
      claude: ["clearer explanation"],
      codex: ["better structure"],
    });
    expect(judgment.openCandleImprovementIdeas).toEqual(["summarize before listing tool output"]);
  });
});
