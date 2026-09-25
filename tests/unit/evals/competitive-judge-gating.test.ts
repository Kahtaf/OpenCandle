import { describe, expect, it } from "vitest";
import {
  analyzeCompetitiveReport,
  buildComparisonJudgePrompt,
  COMPETITIVE_JUDGE_RUBRIC_VERSION,
  type ComparisonJudgment,
  competitiveJudgeMissingAuthMessage,
  DEFAULT_COMPETITIVE_JUDGE,
  formatCompetitiveReportAnalysisMarkdown,
  isUnsupportedTemperatureError,
  mandatoryOutcomeFromResult,
  selectCompetitiveJudgeModel,
  selectCompetitiveJudgeModelOverride,
  stampComparisonJudgment,
  summarizeCompetitiveResults,
} from "../../evals/competitive-finance.js";
import type { EvalTrace } from "../../evals/types.js";

const prompt = {
  id: "frozen-hedge",
  prompt: "I own 450 shares and want downside protection. How many puts?",
  topic: "options hedge sizing",
  complexity: "complex" as const,
  evaluationFocus: "size puts by 100-share contracts",
};

function trace(overrides: Partial<EvalTrace> = {}): EvalTrace {
  return {
    prompt: prompt.prompt,
    classification: {
      workflow: "general_finance_qa",
      confidence: 0.9,
      tier: "rule",
      entities: {},
    },
    toolCalls: [],
    askUserTranscript: [],
    text: "OpenCandle answer",
    ...overrides,
  };
}

const competitor = {
  id: "claude",
  label: "Claude",
  provider: "acpx/claude",
  model: "subscription",
  answer: "Claude answer",
};

function judgment(winner: string): ComparisonJudgment {
  return {
    winner,
    openCandleScore: 9,
    competitorScores: { claude: 7 },
    reason: "reason",
    openCandleDidBetter: [],
    competitorsDidBetter: {},
    openCandleImprovementIdeas: [],
  };
}

const failedHard = [
  { assertion: "sizes hedge from 450 shares", passed: true, reason: "ok", deterministic: true },
  {
    assertion: "frames hedge floor and premium",
    passed: false,
    reason: "missing net floor",
    deterministic: true,
  },
];
const passedHard = [
  { assertion: "sizes hedge from 450 shares", passed: true, reason: "ok", deterministic: true },
];

describe("competitive judge evidence context", () => {
  it("shows the judge bounded tool-result evidence so tool-backed figures are verifiable", () => {
    const longTail = "x".repeat(20_000);
    const judgePrompt = buildComparisonJudgePrompt({
      prompt,
      asOfDate: "2026-09-25",
      openCandleTrace: trace({
        toolCalls: [
          {
            name: "get_economic_data",
            args: { series_id: "DGS10" },
            result: {
              content: [{ type: "text", text: `Latest: 5.11 (2026-09-23)\n${longTail}` }],
            },
          },
        ],
      }),
      competitorAnswers: [competitor],
    });

    expect(judgePrompt).toContain("OpenCandle tool evidence");
    expect(judgePrompt).toContain("Latest: 5.11 (2026-09-23)");
    expect(judgePrompt.length).toBeLessThan(15_000);
    expect(judgePrompt).toContain("[truncated]");
  });

  it("treats figures missing from a truncated excerpt as unverified, not fabricated", () => {
    const judgePrompt = buildComparisonJudgePrompt({
      prompt,
      asOfDate: "2026-09-25",
      openCandleTrace: trace(),
      competitorAnswers: [competitor],
    });

    expect(judgePrompt).toMatch(
      /excerpt is marked \[truncated\], a figure missing from it may be in the omitted part/i,
    );
    expect(COMPETITIVE_JUDGE_RUBRIC_VERSION).toBe("competitive-judge-v3");
  });

  it("anchors dates to the as-of date and forbids calling tool-backed figures fabricated", () => {
    const judgePrompt = buildComparisonJudgePrompt({
      prompt,
      asOfDate: "2026-09-25",
      openCandleTrace: trace(),
      competitorAnswers: [competitor],
    });

    expect(judgePrompt).toContain("Current date: 2026-09-25");
    expect(judgePrompt).toMatch(/training data may end before the current date/i);
    expect(judgePrompt).toMatch(
      /figure that matches the OpenCandle tool evidence is tool-backed, not fabricated/i,
    );
  });

  it("gives the judge the deterministic mandatory results as authoritative", () => {
    const judgePrompt = buildComparisonJudgePrompt({
      prompt,
      asOfDate: "2026-09-25",
      openCandleTrace: trace(),
      competitorAnswers: [competitor],
      hardAssertionResults: failedHard,
    });

    expect(judgePrompt).toContain("OpenCandle deterministic mandatory checks");
    expect(judgePrompt).toContain("FAIL: frames hedge floor and premium");
    expect(judgePrompt).toContain("PASS: sizes hedge from 450 shares");
    expect(judgePrompt).toMatch(/authoritative/i);
  });

  it("labels observed-only structured checks as heuristics, not verdicts", () => {
    const judgePrompt = buildComparisonJudgePrompt({
      prompt,
      asOfDate: "2026-09-25",
      openCandleTrace: trace({
        planning: {
          structuredCheckIds: [],
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: [],
          capabilityGapIds: [],
          evidenceRecords: [],
          structuredCheckResults: [],
          structuredCheckFailures: [
            {
              checkId: "data_gap_disclosed",
              passed: false,
              observedOnly: true,
              failureReason: "metadata missing",
            } as never,
          ],
          retryEligibility: { eligible: false, activeRetryAllowed: false, reasons: [] },
        },
      }),
      competitorAnswers: [competitor],
    });

    expect(judgePrompt).toContain('"observedOnly": true');
    expect(judgePrompt).toMatch(/observed-only .*not verdicts/i);
  });
});

describe("competitive judge preference never implies correctness", () => {
  it("derives the mandatory outcome from deterministic results", () => {
    expect(mandatoryOutcomeFromResult({ hardAssertionResults: failedHard })).toEqual({
      status: "failed",
      failed: ["frames hedge floor and premium"],
    });
    expect(mandatoryOutcomeFromResult({ hardAssertionResults: passedHard })).toEqual({
      status: "passed",
      failed: [],
    });
    expect(mandatoryOutcomeFromResult({ hardAssertionResults: [] }).status).toBe("not_evaluated");
    expect(mandatoryOutcomeFromResult({}).status).toBe("not_evaluated");
    expect(
      mandatoryOutcomeFromResult({
        hardAssertionResults: [{ ...passedHard[0], deterministic: false }],
      }),
    ).toEqual({ status: "failed", failed: ["sizes hedge from 450 shares"] });
  });

  it("prefers a recorded completion case over re-deriving from assertion results", () => {
    expect(
      mandatoryOutcomeFromResult({
        hardAssertionResults: passedHard,
        mandatory: { status: "failed", reason: "hard assertion result count 1 does not match 3" },
      }),
    ).toEqual({
      status: "failed",
      failed: ["hard assertion result count 1 does not match 3"],
    });
  });

  it("reports preference wins separately from correct (mandatory-passing) wins", () => {
    const summary = summarizeCompetitiveResults([
      { judgment: judgment("opencandle"), hardAssertionResults: failedHard },
      { judgment: judgment("opencandle"), hardAssertionResults: passedHard },
      { judgment: judgment("claude"), hardAssertionResults: failedHard },
      { judgment: judgment("tie") },
    ]);

    expect(summary.openCandleWins).toBe(2);
    expect(summary.competitorWins).toEqual({ claude: 1 });
    expect(summary.ties).toBe(1);
    expect(summary.openCandleWinsWithMandatoryPass).toBe(1);
    expect(summary.openCandleWinsWithMandatoryFailure).toBe(1);
    expect(summary.mandatory).toEqual({ passed: 1, failed: 2, notEvaluated: 1 });
  });

  it("marks judge-won cases with failed mandatory checks as ineligible in the analysis", () => {
    const analysis = analyzeCompetitiveReport({
      results: [
        {
          prompt,
          openCandleTrace: { toolCalls: [] },
          competitorAnswers: [],
          judgment: judgment("opencandle"),
          hardAssertionResults: failedHard,
        },
      ],
    });

    expect(analysis.openCandleWins).toBe(1);
    expect(analysis.openCandleWinsWithMandatoryFailure).toBe(1);
    expect(analysis.openCandleWinsWithMandatoryPass).toBe(0);
    expect(analysis.cases[0]?.mandatory).toEqual({
      status: "failed",
      failed: ["frames hedge floor and premium"],
    });

    const markdown = formatCompetitiveReportAnalysisMarkdown(analysis);
    expect(markdown).toMatch(/judge preference is advisory/i);
    expect(markdown).toContain("Mandatory: 0 passed, 1 failed, 0 not evaluated.");
    expect(markdown).toContain(
      "OC preference wins with all mandatory checks passed: 0; preference wins on mandatory-failed cases (ineligible): 1.",
    );
    expect(markdown).toContain(
      "Mandatory: FAILED (frames hedge floor and premium). Judge preference does not make this case correct.",
    );
  });

  it("stamps judgments with judge model and rubric version; missing stamp reads as legacy", () => {
    const stamped = stampComparisonJudgment(judgment("claude"), {
      provider: "google",
      model: "gemini-2.5-flash",
    });
    expect(stamped.judge).toEqual({
      provider: "google",
      model: "gemini-2.5-flash",
      rubricVersion: COMPETITIVE_JUDGE_RUBRIC_VERSION,
    });

    const analysis = analyzeCompetitiveReport({
      results: [
        { prompt, openCandleTrace: { toolCalls: [] }, judgment: stamped },
        {
          prompt: { ...prompt, id: "legacy" },
          openCandleTrace: { toolCalls: [] },
          judgment: judgment("opencandle"),
        },
      ],
    });
    const byId = Object.fromEntries(analysis.cases.map((c) => [c.id, c]));
    expect(byId["frozen-hedge"]?.judge).toEqual(stamped.judge);
    expect(byId.legacy?.judge).toEqual({ rubricVersion: "legacy" });

    const markdown = formatCompetitiveReportAnalysisMarkdown(analysis);
    expect(markdown).toContain(
      `Judge: google/gemini-2.5-flash, rubric ${COMPETITIVE_JUDGE_RUBRIC_VERSION}.`,
    );
    expect(markdown).toContain("Judge: unrecorded model, rubric legacy.");
  });

  it("attributes legacy judgments to the report-level judge without inventing a rubric", () => {
    const analysis = analyzeCompetitiveReport({
      judge: { provider: "google", model: "gemini-2.5-flash" },
      results: [{ prompt, openCandleTrace: { toolCalls: [] }, judgment: judgment("opencandle") }],
    });
    expect(analysis.cases[0]?.judge).toEqual({
      provider: "google",
      model: "gemini-2.5-flash",
      rubricVersion: "legacy",
    });
  });

  it("lets the judge model be overridden separately from the model under test", () => {
    expect(selectCompetitiveJudgeModelOverride({})).toBeNull();
    expect(
      selectCompetitiveJudgeModelOverride({
        OPENCANDLE_COMPETITIVE_JUDGE_PROVIDER: "openai",
        OPENCANDLE_COMPETITIVE_JUDGE_MODEL: "gpt-6-luna",
      }),
    ).toEqual({ provider: "openai", model: "gpt-6-luna" });
    expect(() =>
      selectCompetitiveJudgeModelOverride({ OPENCANDLE_COMPETITIVE_JUDGE_MODEL: "gpt-6-luna" }),
    ).toThrow(/OPENCANDLE_COMPETITIVE_JUDGE_PROVIDER/);
  });
});

describe("competitive judge selection", () => {
  it("defaults the judge to openai/gpt-6-luna, independent of the model under test", () => {
    expect(DEFAULT_COMPETITIVE_JUDGE).toEqual({ provider: "openai", model: "gpt-6-luna" });
    expect(
      selectCompetitiveJudgeModel({
        OPENCANDLE_COMPETITIVE_PROVIDER: "google",
        OPENCANDLE_COMPETITIVE_MODEL: "gemini-2.5-flash",
      }),
    ).toEqual({ provider: "openai", model: "gpt-6-luna", temperature: undefined });
  });

  it("keeps the env override and sends temperature 0 to overridden judges", () => {
    expect(
      selectCompetitiveJudgeModel({
        OPENCANDLE_COMPETITIVE_JUDGE_PROVIDER: "google",
        OPENCANDLE_COMPETITIVE_JUDGE_MODEL: "gemini-2.5-flash",
      }),
    ).toEqual({ provider: "google", model: "gemini-2.5-flash", temperature: 0 });
    expect(() =>
      selectCompetitiveJudgeModel({ OPENCANDLE_COMPETITIVE_JUDGE_PROVIDER: "openai" }),
    ).toThrow(/OPENCANDLE_COMPETITIVE_JUDGE_MODEL/);
  });

  it("omits temperature up front when the calibrated judge is pinned explicitly", () => {
    expect(
      selectCompetitiveJudgeModel({
        OPENCANDLE_COMPETITIVE_JUDGE_PROVIDER: "openai",
        OPENCANDLE_COMPETITIVE_JUDGE_MODEL: "gpt-6-luna",
      }).temperature,
    ).toBeUndefined();
  });

  it("names the judge and its key when judge auth is missing instead of falling back", () => {
    const message = competitiveJudgeMissingAuthMessage(DEFAULT_COMPETITIVE_JUDGE);
    expect(message).toContain("openai/gpt-6-luna");
    expect(message).toContain("OPENAI_API_KEY");
    expect(message).toContain("OPENCANDLE_COMPETITIVE_JUDGE_PROVIDER");
    expect(message).toMatch(/no fallback/i);
  });
});

describe("competitive model call options", () => {
  it("drops temperature only when the provider rejects it", () => {
    expect(
      isUnsupportedTemperatureError(
        `OpenAI API error (400): {"message":"Unsupported parameter: 'temperature' is not supported with this model.","param":"temperature"}`,
      ),
    ).toBe(true);
    expect(isUnsupportedTemperatureError("OpenAI API error (429): rate limit")).toBe(false);
    expect(isUnsupportedTemperatureError("Unsupported parameter: 'top_p'")).toBe(false);
  });
});
