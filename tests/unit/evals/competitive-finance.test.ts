import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDefaultDatabase } from "../../../src/memory/sqlite.js";
import {
  analyzeCompetitiveReport,
  buildComparisonJudgePrompt,
  buildComparisonJudgeRetryPrompt,
  buildGenericAgentPrompt,
  buildPortableAgentPath,
  buildPromptGenerationPrompt,
  buildSavedStateSummary,
  COMPETITIVE_STATE_FIXTURE,
  competitiveBenchmarkExitCode,
  competitivePreflightTimeoutMs,
  competitiveReportAnalysisPath,
  extractUsableAnswerFromCliFailure,
  FROZEN_COMPETITIVE_PANEL,
  findCachedCompetitorAnswer,
  findCachedPromptMetadata,
  fixedPromptFromEnv,
  formatCompetitiveReportAnalysisMarkdown,
  frozenCompetitivePanelFromEnv,
  parseComparisonJudgment,
  parseGeneratedPrompts,
  resolveRequestAuthWithEnvApiKeyFallback,
  selectCliFailureMessage,
  selectCompetitiveCodexModel,
  selectCompetitiveGeminiBaseline,
  selectDefaultCompetitiveModel,
  shouldRetryCompetitiveModelCall,
} from "../../evals/competitive-finance.js";
import { seedOpenCandleHomeMarketState } from "../../evals/runner.js";
import type { EvalTrace } from "../../evals/types.js";

describe("competitive finance benchmarking", () => {
  it("seeds the competitive saved-state fixture into a harness OPENCANDLE_HOME", () => {
    const originalHome = process.env.OPENCANDLE_HOME;
    const home = mkdtempSync(join(tmpdir(), "oc-competitive-state-"));
    process.env.OPENCANDLE_HOME = home;

    try {
      seedOpenCandleHomeMarketState(COMPETITIVE_STATE_FIXTURE);

      const db = initDefaultDatabase();
      try {
        const service = new MarketStateService(db);
        expect(service.listPortfolioLots()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ symbol: "SPY", quantity: 60, avgCost: 480 }),
            expect.objectContaining({ symbol: "AAPL", quantity: 40, avgCost: 175 }),
            expect.objectContaining({ symbol: "XLE", quantity: 100, avgCost: 85 }),
          ]),
        );
        expect(service.listWatchlistItems()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ symbol: "MSFT" }),
            expect.objectContaining({ symbol: "JPM" }),
          ]),
        );
      } finally {
        db.close();
      }
    } finally {
      if (originalHome === undefined) {
        delete process.env.OPENCANDLE_HOME;
      } else {
        process.env.OPENCANDLE_HOME = originalHome;
      }
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("generates broad finance prompts without assuming OpenCandle should win", () => {
    const prompt = buildPromptGenerationPrompt({
      count: 4,
      seed: "coverage-a",
      asOfDate: "2026-05-16",
    });

    expect(prompt).toContain("Generate 4 realistic finance prompts");
    expect(prompt).toContain("Current date for this benchmark run: 2026-05-16");
    expect(prompt).toContain(
      "Do not bias toward prompts where OpenCandle obviously has a tool advantage",
    );
    expect(prompt).toContain("average retail investor");
    expect(prompt).toContain("Do not mention OpenCandle");
    expect(prompt).toContain("or tools inside the user-facing prompt");
    expect(prompt).toContain("messy, conversational wording");
    expect(prompt).toContain("A generic agent may be better");
    expect(prompt).toContain("what OpenCandle needs to improve");
  });

  it("asks the prompt generator for saved-state prompts when a state summary is provided", () => {
    const summary = buildSavedStateSummary(COMPETITIVE_STATE_FIXTURE);
    const prompt = buildPromptGenerationPrompt({
      count: 5,
      seed: "2026-06-12",
      asOfDate: "2026-06-12",
      savedStateSummary: summary,
    });

    expect(prompt).toContain(summary);
    expect(prompt.toLowerCase()).toContain("saved");
    expect(prompt).toMatch(/my portfolio|my watchlist|my holdings/i);

    const withoutState = buildPromptGenerationPrompt({
      count: 5,
      seed: "s",
      asOfDate: "2026-06-12",
    });
    expect(withoutState).not.toContain(summary);
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

  it("gives generic agents the same saved-state facts for fairness", () => {
    const summary = buildSavedStateSummary(COMPETITIVE_STATE_FIXTURE);
    const withState = buildGenericAgentPrompt("How is my portfolio doing?", {
      agentName: "Claude",
      asOfDate: "2026-06-12",
      savedStateSummary: summary,
    });
    expect(withState).toContain(summary);

    const withoutState = buildGenericAgentPrompt("How is my portfolio doing?", {
      agentName: "Claude",
      asOfDate: "2026-06-12",
    });
    expect(withoutState).not.toContain("saved OpenCandle state");
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

    expect(
      buildGenericAgentPrompt(trace.prompt, { agentName: "Claude", asOfDate: "2026-05-16" }),
    ).toContain("Current date: 2026-05-16");
    expect(judgePrompt).toContain("Current date: 2026-05-16");
    expect(judgePrompt).toContain("Agent: Claude (claude, anthropic/claude-sonnet-4-5)");
    expect(judgePrompt).toContain("Agent: Codex (codex, openai-codex/gpt-5.3-codex-spark)");
    expect(judgePrompt).toContain("Agent: Gemini (gemini, google/gemini-cli)");
    expect(judgePrompt).toContain("It is acceptable for any generic agent to win");
    expect(judgePrompt).toContain(
      "Treat dates on or before the current date as current or historical",
    );
    expect(judgePrompt).toContain("Do not reward fabricated current facts");
    expect(judgePrompt).toContain(
      "A no-tool agent that presents unverified live prices, filings, options chains, sentiment, macro probabilities, or filing changes as factual should be penalized",
    );
    expect(judgePrompt).toContain("get_sec_filings");
    expect(judgePrompt).not.toContain("OpenCandle router telemetry");
  });

  it("tells the judge to verify saved-state usage when state is seeded", () => {
    const summary = buildSavedStateSummary(COMPETITIVE_STATE_FIXTURE);
    const prompt = buildComparisonJudgePrompt({
      prompt: {
        id: "p1",
        prompt: "How risky is my portfolio?",
        topic: "portfolio",
        complexity: "moderate",
        evaluationFocus: "personalization",
      },
      asOfDate: "2026-06-12",
      openCandleTrace: {
        text: "answer",
        toolCalls: [],
        classification: {},
        planning: null,
      } as never,
      competitorAnswers: [
        { id: "claude", label: "Claude", provider: "anthropic", model: "m", answer: "a" },
      ],
      savedStateSummary: summary,
    });

    expect(prompt).toContain(summary);
    expect(prompt.toLowerCase()).toContain("saved state");
    expect(prompt.toLowerCase()).toMatch(/penal/);
  });

  it("anchors the judge score scale so scores are comparable across runs", () => {
    const prompt = buildComparisonJudgePrompt({
      prompt: {
        id: "p1",
        prompt: "Should I buy index funds?",
        topic: "investing",
        complexity: "simple",
        evaluationFocus: "clarity",
      },
      asOfDate: "2026-06-12",
      openCandleTrace: {
        text: "answer",
        toolCalls: [],
        classification: {},
        planning: null,
      } as never,
      competitorAnswers: [
        { id: "claude", label: "Claude", provider: "anthropic", model: "m", answer: "a" },
      ],
    });

    expect(prompt).toContain("0-10");
    expect(prompt.toLowerCase()).toContain("10 = ");
    expect(prompt.toLowerCase()).toContain("5 = ");
  });

  it("builds a retry prompt when comparison judgment JSON is invalid", () => {
    const retryPrompt = buildComparisonJudgeRetryPrompt({
      originalPrompt: "Compare OpenCandle against baselines and return JSON.",
      invalidResponse: '{ "winner": "opencandle"',
      errorMessage: "Expected ',' or '}'",
    });

    expect(retryPrompt).toContain("previous comparison judgment was invalid JSON");
    expect(retryPrompt).toContain("Expected ',' or '}'");
    expect(retryPrompt).toContain("Return JSON only");
    expect(retryPrompt).toContain('{ "winner": "opencandle"');
    expect(retryPrompt).toContain("Compare OpenCandle against baselines and return JSON.");
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

  it("normalizes winner case and rejects winners outside the allowed set", () => {
    const raw = (winner: string) => `{
      "winner": "${winner}",
      "openCandleScore": 6,
      "competitorScores": { "claude": 7 },
      "reason": "r",
      "openCandleDidBetter": [],
      "competitorsDidBetter": { "claude": [] },
      "openCandleImprovementIdeas": []
    }`;
    const allowedWinners = ["opencandle", "claude", "tie"];

    expect(parseComparisonJudgment(raw("OpenCandle "), { allowedWinners }).winner).toBe(
      "opencandle",
    );
    expect(parseComparisonJudgment(raw("TIE"), { allowedWinners }).winner).toBe("tie");
    expect(() => parseComparisonJudgment(raw("gemini"), { allowedWinners })).toThrow(/winner/i);
  });

  it("repairs common missing-comma JSON from comparison judgments", () => {
    const judgment = parseComparisonJudgment(`{
      "winner": "opencandle",
      "openCandleScore": 5,
      "competitorScores": {
        "claude": 4
        "codex": 3
      },
      "reason": "OpenCandle used current evidence.",
      "openCandleDidBetter": [
        "used live market data"
        "gave a clearer downside case"
      ],
      "competitorsDidBetter": {
        "claude": [
          "shorter explanation"
          "simpler onboarding guidance"
        ]
      },
      "openCandleImprovementIdeas": [
        "lead with the recommendation"
        "trim account-opening background"
      ]
    }`);

    expect(judgment.competitorScores).toEqual({ claude: 4, codex: 3 });
    expect(judgment.openCandleDidBetter).toEqual([
      "used live market data",
      "gave a clearer downside case",
    ]);
    expect(judgment.competitorsDidBetter.claude).toEqual([
      "shorter explanation",
      "simpler onboarding guidance",
    ]);
    expect(judgment.openCandleImprovementIdeas).toEqual([
      "lead with the recommendation",
      "trim account-opening background",
    ]);
  });

  it("repairs missing commas between array object values in comparison judgments", () => {
    const judgment = parseComparisonJudgment(`{
      "winner": "opencandle",
      "openCandleScore": 5,
      "competitorScores": {
        "claude": 4,
        "codex": 3
      },
      "reason": "OpenCandle used current evidence.",
      "openCandleDidBetter": [
        "used live market data"
        {"note": "ignored non-string object"}
        "gave a clearer downside case"
      ],
      "competitorsDidBetter": {},
      "openCandleImprovementIdeas": [
        {"layer": "synthesis", "idea": "lead with the recommendation"}
        {"layer": "structured-check", "idea": "state source coverage"}
        "trim account-opening background"
      ]
    }`);

    expect(judgment.openCandleDidBetter).toEqual([
      "used live market data",
      "gave a clearer downside case",
    ]);
    expect(judgment.openCandleImprovementIdeas).toEqual(["trim account-opening background"]);
  });

  it("repairs comparison judgments with an omitted closing array bracket", () => {
    const judgment = parseComparisonJudgment(`{
      "winner": "opencandle",
      "openCandleScore": 5,
      "competitorScores": {
        "claude": 4,
        "codex": 3
      },
      "reason": "OpenCandle used current evidence.",
      "openCandleDidBetter": [
        "used live market data"
      ],
      "competitorsDidBetter": {},
      "openCandleImprovementIdeas": [
        "lead with the recommendation"
    }`);

    expect(judgment.openCandleImprovementIdeas).toEqual(["lead with the recommendation"]);
  });

  it("repairs comparison judgments with extra trailing object delimiters", () => {
    const judgment = parseComparisonJudgment(`{
      "winner": "opencandle",
      "openCandleScore": 5,
      "competitorScores": {
        "claude": 4,
        "codex": 3
      },
      "reason": "OpenCandle used current evidence.",
      "openCandleDidBetter": [
        "used live market data"
      ],
      "competitorsDidBetter": {},
      "openCandleImprovementIdeas": [
        "lead with the recommendation"
      ]
    },
    }`);

    expect(judgment.winner).toBe("opencandle");
    expect(judgment.openCandleImprovementIdeas).toEqual(["lead with the recommendation"]);
  });

  it("extracts usable agent text from non-zero CLI failures", () => {
    const answer = extractUsableAnswerFromCliFailure(
      "/repo/node_modules/.bin/acpx --cwd /tmp/oc failed: As of May 17, 2026, here is the analysis.\n\nDetails follow.",
    );

    expect(answer).toBe("As of May 17, 2026, here is the analysis.\n\nDetails follow.");
  });

  it("does not treat infrastructure failures as usable agent answers", () => {
    expect(extractUsableAnswerFromCliFailure("failed: Internal error: bad auth")).toBeNull();
    expect(
      extractUsableAnswerFromCliFailure("failed: Gemini CLI ACP startup timed out"),
    ).toBeNull();
    expect(
      extractUsableAnswerFromCliFailure("failed: Error handling request { denied: true }"),
    ).toBeNull();
  });

  it("prefers stdout answers over stderr diagnostics on CLI failures", () => {
    expect(
      selectCliFailureMessage({
        stdout: "Useful model answer",
        stderr: "warning: adapter exited non-zero",
        status: 1,
      }),
    ).toBe("Useful model answer");
    expect(
      selectCliFailureMessage({
        stdout: "",
        stderr: "warning: adapter exited non-zero",
        status: 1,
      }),
    ).toBe("warning: adapter exited non-zero");
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

  it("defines a frozen competitive panel from historical loss classes", () => {
    const manifest = JSON.parse(
      readFileSync("docs/internal/prompt-to-policy-migration-manifest.json", "utf-8"),
    ) as {
      prompts: Array<{ id: string; expected: { finalAnswerHardAssertions?: string[] } }>;
    };
    const promptsById = new Map(manifest.prompts.map((prompt) => [prompt.id, prompt]));

    expect(frozenCompetitivePanelFromEnv({})).toBeNull();
    expect(frozenCompetitivePanelFromEnv({ OPENCANDLE_COMPETITIVE_PANEL: "frozen" })).toStrictEqual(
      FROZEN_COMPETITIVE_PANEL,
    );
    expect(FROZEN_COMPETITIVE_PANEL).toHaveLength(5);
    expect(FROZEN_COMPETITIVE_PANEL.map((prompt) => prompt.lossClass)).toEqual([
      "portfolio-review-not-builder",
      "1-2 weeks DTE preservation",
      "protective-put-not-bullish-call",
      "unknown-ticker-no-dead-end",
      "hedge sizing with share count",
    ]);
    expect(new Set(FROZEN_COMPETITIVE_PANEL.map((prompt) => prompt.prompt)).size).toBe(5);
    expect(
      FROZEN_COMPETITIVE_PANEL.every((prompt) => prompt.promptPolicyManifestId.length > 0),
    ).toBe(true);
    for (const prompt of FROZEN_COMPETITIVE_PANEL) {
      expect(
        promptsById.get(prompt.promptPolicyManifestId)?.expected.finalAnswerHardAssertions,
      ).toBeDefined();
      expect(
        promptsById.get(prompt.promptPolicyManifestId)?.expected.finalAnswerHardAssertions?.length,
      ).toBeGreaterThan(0);
    }
  });

  it("finds cached competitor answers by exact prompt text and competitor id", () => {
    const cache = [
      {
        path: "/repo/tests/evals/runs/old_competitive-finance.json",
        report: {
          results: [
            {
              prompt: {
                id: "macro",
                prompt: "Evaluate a 60/40 portfolio.",
                topic: "macro",
                complexity: "complex",
                evaluationFocus: "Original neutral focus.",
              },
              competitorAnswers: [
                {
                  id: "claude",
                  label: "Claude",
                  provider: "acpx/claude",
                  model: "subscription",
                  answer: "Cached Claude answer",
                },
              ],
            },
          ],
        },
      },
    ];

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

  // A crashed baseline records a failure-placeholder answer with `error`
  // set; reusing it from cache would freeze the failure into every later
  // run instead of retrying the baseline live (or skipping it honestly at
  // preflight).
  it("does not reuse failed baseline answers from the cache", () => {
    const cache = [
      {
        path: "/repo/tests/evals/runs/old_competitive-finance.json",
        report: {
          results: [
            {
              prompt: {
                id: "macro",
                prompt: "Evaluate a 60/40 portfolio.",
                topic: "macro",
                complexity: "complex",
                evaluationFocus: "Original neutral focus.",
              },
              competitorAnswers: [
                {
                  id: "claude",
                  label: "Claude",
                  provider: "acpx/claude",
                  model: "subscription",
                  answer: "Claude baseline failed before answering: monthly spend limit",
                  error: "monthly spend limit",
                },
              ],
            },
          ],
        },
      },
    ];

    expect(findCachedCompetitorAnswer(cache, "Evaluate a 60/40 portfolio.", "claude")).toBeNull();
  });

  it("finds cached prompt metadata so reruns keep the original judge focus", () => {
    const cache = [
      {
        path: "/repo/tests/evals/runs/old_competitive-finance.json",
        report: {
          results: [
            {
              prompt: {
                id: "generated-id",
                prompt: "Evaluate a 60/40 portfolio.",
                topic: "portfolio evaluation",
                complexity: "complex",
                evaluationFocus: "Judge the portfolio analysis neutrally.",
              },
              competitorAnswers: [],
            },
          ],
        },
      },
    ];

    expect(findCachedPromptMetadata(cache, "Evaluate a 60/40 portfolio.")).toEqual({
      id: "generated-id",
      prompt: "Evaluate a 60/40 portfolio.",
      topic: "portfolio evaluation",
      complexity: "complex",
      evaluationFocus: "Judge the portfolio analysis neutrally.",
    });
  });

  it("analyzes judge output into loss reasons and improvement themes", () => {
    const analysis = analyzeCompetitiveReport(
      {
        generatedAt: "2026-05-23T01:30:00.000Z",
        results: [
          {
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
            competitorAnswers: [
              {
                id: "claude",
                label: "Claude",
                provider: "acpx/claude",
                model: "subscription",
                answer: "Claude answer",
                cachedFromReport: "old.json",
              },
            ],
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
          },
        ],
      },
      { reportPath: "report.json" },
    );

    expect(analysis.losses).toBe(1);
    expect(analysis.cases[0]).toMatchObject({
      id: "macro-portfolio",
      winner: "claude",
      lostTo: "claude",
      scoreGap: 1,
      toolCalls: ["get_economic_data", "search_web"],
      cachedCompetitors: ["claude"],
    });
    expect(analysis.themeSummary.map((theme) => theme.theme)).toContain(
      "data retrieval and integration",
    );
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
      themeSummary: [
        {
          theme: "data retrieval and integration",
          count: 1,
          caseIds: ["macro-portfolio"],
          ideas: ["Integrate current macro data into the synthesis."],
        },
      ],
      cases: [
        {
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
        },
      ],
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

    expect(
      selectDefaultCompetitiveModel({
        googleAuthConfigured: false,
        googleModel: { provider: "google", id: "gemini-2.5-flash", contextWindow: 1_000_000 },
        available: [smallContext, largeContext],
      }),
    ).toBe(largeContext);
  });

  it("uses the ACP-advertised Codex model id by default", () => {
    // The current codex ACP agent advertises plain model ids
    // (gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.3-codex-spark); the old
    // reasoning-suffixed "gpt-5.3-codex-spark[medium]" id is rejected with
    // "did not advertise that model", which made the codex baseline fail
    // preflight and get skipped.
    expect(selectCompetitiveCodexModel({})).toBe("gpt-5.3-codex-spark");
    expect(
      selectCompetitiveCodexModel({
        OPENCANDLE_COMPETITIVE_CODEX_MODEL: "gpt-5.5[high]",
      }),
    ).toBe("gpt-5.5[high]");
  });

  it("prefers Gemini API auth over the retired consumer ACP CLI", () => {
    expect(selectCompetitiveGeminiBaseline({ GEMINI_API_KEY: "key" })).toEqual({
      mode: "api",
      provider: "google",
      model: "gemini-2.5-flash",
    });
    expect(
      selectCompetitiveGeminiBaseline({
        GEMINI_API_KEY: "key",
        OPENCANDLE_COMPETITIVE_GEMINI_MODEL: "gemini-3-flash",
      }),
    ).toEqual({
      mode: "api",
      provider: "google",
      model: "gemini-3-flash",
    });
    expect(selectCompetitiveGeminiBaseline({ GOOGLE_API_KEY: "key" })).toEqual({
      mode: "api",
      provider: "google",
      model: "gemini-2.5-flash",
    });
    expect(selectCompetitiveGeminiBaseline({})).toEqual({
      mode: "acpx",
      provider: "acpx/gemini",
      model: "subscription",
    });
    expect(
      selectCompetitiveGeminiBaseline({
        GEMINI_API_KEY: "key",
        OPENCANDLE_COMPETITIVE_GEMINI_AGENT: "acpx",
      }),
    ).toEqual({
      mode: "acpx",
      provider: "acpx/gemini",
      model: "subscription",
    });
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
    expect(
      competitivePreflightTimeoutMs({ OPENCANDLE_COMPETITIVE_PREFLIGHT_TIMEOUT_MS: "120000" }),
    ).toBe(120_000);
    expect(
      competitivePreflightTimeoutMs({ OPENCANDLE_COMPETITIVE_PREFLIGHT_TIMEOUT_MS: "0" }),
    ).toBe(60_000);
  });

  // Pi's ModelRegistry.getApiKeyAndHeaders resolves AuthStorage credentials
  // with includeFallback: false, so an exported GEMINI_API_KEY never reaches
  // the judge/OpenCandle model resolution even though the rest of the repo
  // (TUI harness, router live eval) works from env keys. The eval script
  // seeds the env key as a runtime override and re-resolves.
  describe("resolveRequestAuthWithEnvApiKeyFallback", () => {
    it("keeps registry auth untouched when an api key is already resolved", async () => {
      const setRuntimeApiKey = vi.fn();
      const resolveRequestAuth = vi.fn(async () => ({ ok: true as const, apiKey: "stored-key" }));
      const result = await resolveRequestAuthWithEnvApiKeyFallback({
        provider: "google",
        resolveRequestAuth,
        getEnvApiKey: () => "env-key",
        setRuntimeApiKey,
      });
      expect(result).toEqual({ ok: true, apiKey: "stored-key" });
      expect(resolveRequestAuth).toHaveBeenCalledTimes(1);
      expect(setRuntimeApiKey).not.toHaveBeenCalled();
    });

    it("seeds the env api key as a runtime override and re-resolves when the registry has none", async () => {
      const runtimeKeys = new Map<string, string>();
      const resolveRequestAuth = vi.fn(async () =>
        runtimeKeys.has("google")
          ? { ok: true as const, apiKey: runtimeKeys.get("google") }
          : { ok: true as const, apiKey: undefined },
      );
      const result = await resolveRequestAuthWithEnvApiKeyFallback({
        provider: "google",
        resolveRequestAuth,
        getEnvApiKey: (provider) => (provider === "google" ? "env-gemini-key" : undefined),
        setRuntimeApiKey: (provider, apiKey) => runtimeKeys.set(provider, apiKey),
      });
      expect(result).toEqual({ ok: true, apiKey: "env-gemini-key" });
      expect(resolveRequestAuth).toHaveBeenCalledTimes(2);
    });

    it("retries through the env key when the registry resolution itself fails", async () => {
      const runtimeKeys = new Map<string, string>();
      const resolveRequestAuth = vi.fn(async () =>
        runtimeKeys.has("google")
          ? { ok: true as const, apiKey: runtimeKeys.get("google") }
          : { ok: false as const, error: "no auth configured" },
      );
      const result = await resolveRequestAuthWithEnvApiKeyFallback({
        provider: "google",
        resolveRequestAuth,
        getEnvApiKey: () => "env-gemini-key",
        setRuntimeApiKey: (provider, apiKey) => runtimeKeys.set(provider, apiKey),
      });
      expect(result).toEqual({ ok: true, apiKey: "env-gemini-key" });
    });

    it("returns the original resolution when no env key exists", async () => {
      const setRuntimeApiKey = vi.fn();
      const result = await resolveRequestAuthWithEnvApiKeyFallback({
        provider: "anthropic",
        resolveRequestAuth: async () => ({ ok: false as const, error: "no auth configured" }),
        getEnvApiKey: () => undefined,
        setRuntimeApiKey,
      });
      expect(result).toEqual({ ok: false, error: "no auth configured" });
      expect(setRuntimeApiKey).not.toHaveBeenCalled();
    });
  });
});
