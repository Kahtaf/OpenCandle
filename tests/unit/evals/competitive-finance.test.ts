import { describe, expect, it } from "vitest";
import {
  analyzeCompetitiveReport,
  buildComparisonJudgePrompt,
  buildGenericAgentPrompt,
  buildPromptGenerationPrompt,
  competitiveReportAnalysisPath,
  buildPortableAgentPath,
  competitiveBenchmarkExitCode,
  competitivePreflightTimeoutMs,
  extractUsableAnswerFromCliFailure,
  findCachedCompetitorAnswer,
  findCachedPromptMetadata,
  formatCompetitiveReportAnalysisMarkdown,
  fixedPromptFromEnv,
  parseComparisonJudgment,
  parseGeneratedPrompts,
  selectCliFailureMessage,
  selectDefaultCompetitiveModel,
  shouldRetryCompetitiveModelCall,
} from "../../evals/competitive-finance.js";
import type { EvalTrace } from "../../evals/types.js";

describe("competitive finance benchmarking", () => {
  it("generates broad finance prompts without assuming OpenCandle should win", () => {
    const prompt = buildPromptGenerationPrompt({ count: 4, seed: "coverage-a", asOfDate: "2026-05-16" });

    expect(prompt).toContain("Generate 4 realistic finance prompts");
    expect(prompt).toContain("Current date for this benchmark run: 2026-05-16");
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

  it("compares OpenCandle with generic no-tool answers", () => {
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
        {
          id: "gemini",
          label: "Gemini",
          provider: "google",
          model: "gemini-cli",
          answer: "Gemini answer",
        },
      ],
    });

    expect(buildGenericAgentPrompt(trace.prompt, { agentName: "Claude", asOfDate: "2026-05-16" })).toContain("Current date: 2026-05-16");
    expect(judgePrompt).toContain("Current date: 2026-05-16");
    expect(judgePrompt).toContain("Agent: Claude (claude, anthropic/claude-sonnet-4-5)");
    expect(judgePrompt).toContain("Agent: Codex (codex, openai-codex/gpt-5.3-codex-spark)");
    expect(judgePrompt).toContain("Agent: Gemini (gemini, google/gemini-cli)");
    expect(judgePrompt).toContain("It is acceptable for any generic agent to win");
    expect(judgePrompt).toContain("Treat dates on or before the current date as current or historical");
    expect(judgePrompt).toContain("get_sec_filings");
    expect(judgePrompt).not.toContain("OpenCandle router telemetry");
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

  it("extracts usable agent text from non-zero CLI failures", () => {
    const answer = extractUsableAnswerFromCliFailure(
      "/repo/node_modules/.bin/acpx --cwd /tmp/oc failed: As of May 17, 2026, here is the analysis.\n\nDetails follow.",
    );

    expect(answer).toBe("As of May 17, 2026, here is the analysis.\n\nDetails follow.");
  });

  it("does not treat infrastructure failures as usable agent answers", () => {
    expect(extractUsableAnswerFromCliFailure("failed: Internal error: bad auth")).toBeNull();
    expect(extractUsableAnswerFromCliFailure("failed: Gemini CLI ACP startup timed out")).toBeNull();
    expect(extractUsableAnswerFromCliFailure("failed: Error handling request { denied: true }")).toBeNull();
  });

  it("prefers stdout answers over stderr diagnostics on CLI failures", () => {
    expect(selectCliFailureMessage({
      stdout: "Useful model answer",
      stderr: "warning: adapter exited non-zero",
      status: 1,
    })).toBe("Useful model answer");
    expect(selectCliFailureMessage({
      stdout: "",
      stderr: "warning: adapter exited non-zero",
      status: 1,
    })).toBe("warning: adapter exited non-zero");
  });

  it("builds a portable agent PATH without user-specific toolchain paths", () => {
    const path = buildPortableAgentPath({
      cwd: "/repo",
      HOME: "/home/alice",
      PATH: "/usr/bin:/bin",
      execPath: "/opt/node/bin/node",
    });

    expect(path).toContain("/repo/node_modules/.bin");
    expect(path).toContain("/home/alice/.local/bin");
    expect(path).toContain("/opt/node/bin");
    expect(path).not.toContain("/Users/");
  });

  it("supports rerunning a fixed competitive prompt from env", () => {
    expect(fixedPromptFromEnv({})).toBeNull();

    const prompt = fixedPromptFromEnv({
      OPENCANDLE_COMPETITIVE_PROMPT_ID: "macro-rerun",
      OPENCANDLE_COMPETITIVE_PROMPT: "Analyze inflation and the 60/40 impact.",
      OPENCANDLE_COMPETITIVE_PROMPT_TOPIC: "macro",
      OPENCANDLE_COMPETITIVE_PROMPT_COMPLEXITY: "complex",
      OPENCANDLE_COMPETITIVE_PROMPT_FOCUS: "Check whether OC improves after a prompt fix.",
    });

    expect(prompt).toEqual({
      id: "macro-rerun",
      prompt: "Analyze inflation and the 60/40 impact.",
      topic: "macro",
      complexity: "complex",
      evaluationFocus: "Check whether OC improves after a prompt fix.",
    });
  });

  it("finds cached competitor answers by exact prompt text and competitor id", () => {
    const cache = [{
      path: "/repo/tests/evals/runs/old_competitive-finance.json",
      report: {
        results: [{
          prompt: {
            id: "macro",
            prompt: "Evaluate a 60/40 portfolio.",
            topic: "macro",
            complexity: "complex",
            evaluationFocus: "Original neutral focus.",
          },
          competitorAnswers: [{
            id: "claude",
            label: "Claude",
            provider: "acpx/claude",
            model: "subscription",
            answer: "Cached Claude answer",
          }],
        }],
      },
    }];

    expect(findCachedCompetitorAnswer(cache, "Evaluate a 60/40 portfolio.", "claude")).toEqual({
      id: "claude",
      label: "Claude",
      provider: "acpx/claude",
      model: "subscription",
      answer: "Cached Claude answer",
      cachedFromReport: "/repo/tests/evals/runs/old_competitive-finance.json",
    });
    expect(findCachedCompetitorAnswer(cache, "Evaluate a 60/40 portfolio.", "codex")).toBeNull();
    expect(findCachedCompetitorAnswer(cache, "Different prompt.", "claude")).toBeNull();
  });

  it("finds cached prompt metadata so reruns keep the original judge focus", () => {
    const cache = [{
      path: "/repo/tests/evals/runs/old_competitive-finance.json",
      report: {
        results: [{
          prompt: {
            id: "generated-id",
            prompt: "Evaluate a 60/40 portfolio.",
            topic: "portfolio evaluation",
            complexity: "complex",
            evaluationFocus: "Judge the portfolio analysis neutrally.",
          },
          competitorAnswers: [],
        }],
      },
    }];

    expect(findCachedPromptMetadata(cache, "Evaluate a 60/40 portfolio.")).toEqual({
      id: "generated-id",
      prompt: "Evaluate a 60/40 portfolio.",
      topic: "portfolio evaluation",
      complexity: "complex",
      evaluationFocus: "Judge the portfolio analysis neutrally.",
    });
  });

  it("analyzes judge output into loss reasons and improvement themes", () => {
    const analysis = analyzeCompetitiveReport({
      generatedAt: "2026-05-23T01:30:00.000Z",
      results: [{
        prompt: {
          id: "macro-portfolio",
          prompt: "Evaluate a 60/40 portfolio.",
          topic: "macro",
          complexity: "complex",
          evaluationFocus: "Synthesis and actionability",
        },
        openCandleTrace: {
          toolCalls: [
            { name: "get_economic_data", args: { series_id: "FEDFUNDS" } },
            { name: "search_web", args: { query: "macro outlook" } },
          ],
        },
        competitorAnswers: [{
          id: "claude",
          label: "Claude",
          provider: "acpx/claude",
          model: "subscription",
          answer: "Claude answer",
          cachedFromReport: "old.json",
        }],
        judgment: {
          winner: "claude",
          openCandleScore: 3,
          competitorScores: { claude: 4 },
          reason: "Claude had more portfolio nuance.",
          openCandleDidBetter: ["used tools"],
          competitorsDidBetter: {
            claude: ["named concentration and duration risks"],
          },
          openCandleImprovementIdeas: [
            "Integrate current macro data into the synthesis.",
            "Add a more specific rebalancing adjustment.",
          ],
        },
      }],
    }, { reportPath: "report.json" });

    expect(analysis.losses).toBe(1);
    expect(analysis.cases[0]).toMatchObject({
      id: "macro-portfolio",
      winner: "claude",
      lostTo: "claude",
      scoreGap: 1,
      toolCalls: ["get_economic_data", "search_web"],
      cachedCompetitors: ["claude"],
    });
    expect(analysis.themeSummary.map((theme) => theme.theme)).toContain("data retrieval and integration");
    expect(analysis.themeSummary.map((theme) => theme.theme)).toContain("actionability");
  });

  it("formats competitive report analysis as readable markdown", () => {
    const markdown = formatCompetitiveReportAnalysisMarkdown({
      generatedAt: "2026-05-23T01:30:00.000Z",
      reportPath: "report.json",
      promptCount: 1,
      openCandleWins: 0,
      losses: 1,
      ties: 0,
      themeSummary: [{
        theme: "data retrieval and integration",
        count: 1,
        caseIds: ["macro-portfolio"],
        ideas: ["Integrate current macro data into the synthesis."],
      }],
      cases: [{
        id: "macro-portfolio",
        prompt: "Evaluate a 60/40 portfolio.",
        winner: "claude",
        openCandleScore: 3,
        competitorScores: { claude: 4 },
        scoreGap: 1,
        lostTo: "claude",
        judgeReason: "Claude had more portfolio nuance.",
        openCandleDidBetter: [],
        competitorsDidBetter: { claude: ["named concentration risks"] },
        openCandleImprovementIdeas: ["Integrate current macro data into the synthesis."],
        improvementThemes: ["data retrieval and integration"],
        toolCalls: ["get_economic_data"],
        cachedCompetitors: ["claude"],
      }],
    });

    expect(markdown).toContain("# Competitive Report Analysis");
    expect(markdown).toContain("Summary: OC wins 0, losses 1, ties 0, cases 1.");
    expect(markdown).toContain("Loss gap: claude beat OC by 1.");
    expect(markdown).toContain("Competitors did better:");
    expect(markdown).toContain("OC improvement ideas:");
  });

  it("derives safe analysis paths without overwriting arbitrary report inputs", () => {
    expect(competitiveReportAnalysisPath("runs/old_competitive-finance.json")).toBe(
      "runs/old_competitive-finance-analysis.md",
    );
    expect(competitiveReportAnalysisPath("runs/manual.json")).toBe(
      "runs/manual-competitive-finance-analysis.md",
    );
    expect(competitiveReportAnalysisPath("runs/manual-report")).toBe(
      "runs/manual-report-competitive-finance-analysis.md",
    );
  });

  it("prefers a large-context configured model over the first available model", () => {
    const smallContext = { provider: "openai", id: "gpt-4", contextWindow: 8192 };
    const largeContext = { provider: "openai", id: "gpt-4.1", contextWindow: 1_000_000 };

    expect(selectDefaultCompetitiveModel({
      googleAuthConfigured: false,
      googleModel: { provider: "google", id: "gemini-2.5-flash", contextWindow: 1_000_000 },
      available: [smallContext, largeContext],
    })).toBe(largeContext);
  });

  it("marks completed competitive runs as successful CLI exits", () => {
    expect(competitiveBenchmarkExitCode()).toBe(0);
  });

  it("retries transient competitive model call failures", () => {
    expect(shouldRetryCompetitiveModelCall("fetch failed", 1, 3)).toBe(true);
    expect(shouldRetryCompetitiveModelCall("ECONNRESET while reading response", 2, 3)).toBe(true);
    expect(shouldRetryCompetitiveModelCall("fetch failed", 3, 3)).toBe(false);
    expect(shouldRetryCompetitiveModelCall("invalid api key", 1, 3)).toBe(false);
  });

  it("keeps baseline preflight timeouts short", () => {
    expect(competitivePreflightTimeoutMs({})).toBe(60_000);
    expect(competitivePreflightTimeoutMs({ OPENCANDLE_COMPETITIVE_PREFLIGHT_TIMEOUT_MS: "120000" })).toBe(120_000);
    expect(competitivePreflightTimeoutMs({ OPENCANDLE_COMPETITIVE_PREFLIGHT_TIMEOUT_MS: "0" })).toBe(60_000);
  });
});
