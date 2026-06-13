import { describe, expect, it } from "vitest";
import { comparePromptPolicyReports } from "../../evals/prompt-policy-ref-parity.js";

const baseCase = {
  id: "ticker-alias-armh",
  passed: true,
  failures: [],
  observed: {
    routeKind: "agent_task",
    workflow: "general_finance_qa",
    taskFamily: "ticker_disambiguation",
    commitmentMode: "framework",
    policyCardId: "ticker_disambiguation",
    evidencePlanId: "ticker_disambiguation",
    answerContractId: "ticker_disambiguation",
    toolBundles: ["core_market"],
    toolCalls: ["search_ticker", "get_company_overview"],
    evidenceTypes: ["ticker_disambiguation", "tool_result"],
    capabilityGapIds: ["earnings_event_risk"],
    structuredCheckFailures: ["data_gap_disclosed"],
    retryEligible: true,
    finalTextLength: 700,
  },
  finalAnswerHardAssertions: [
    { assertion: "distinguishes legacy ticker", passed: true, reason: "ok" },
  ],
};

describe("prompt policy ref parity", () => {
  it("passes when both reports satisfy manifest assertions and stable fields match", () => {
    const report = comparePromptPolicyReports({
      baseLabel: "before",
      currentLabel: "current",
      baseCases: [baseCase],
      currentCases: [
        {
          ...baseCase,
          observed: {
            ...baseCase.observed,
            toolCalls: ["get_company_overview", "search_ticker"],
            finalTextLength: 900,
          },
        },
      ],
    });

    expect(report.summary).toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(report.cases[0]?.warnings).toContainEqual(
      expect.objectContaining({
        field: "toolCalls",
      }),
    );
  });

  it("fails on stable planning or assertion regressions", () => {
    const report = comparePromptPolicyReports({
      baseLabel: "before",
      currentLabel: "current",
      baseCases: [baseCase],
      currentCases: [
        {
          ...baseCase,
          observed: {
            ...baseCase.observed,
            taskFamily: "single_asset_decision",
          },
          finalAnswerHardAssertions: [
            { assertion: "distinguishes legacy ticker", passed: false, reason: "missing" },
          ],
        },
      ],
    });

    expect(report.summary.failed).toBe(1);
    expect(report.cases[0]?.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "taskFamily" }),
        expect.objectContaining({ field: "finalAnswerHardAssertions" }),
      ]),
    );
  });

  it("warns rather than fails when the current report adds evidence", () => {
    const report = comparePromptPolicyReports({
      baseLabel: "before",
      currentLabel: "current",
      baseCases: [baseCase],
      currentCases: [
        {
          ...baseCase,
          observed: {
            ...baseCase.observed,
            evidenceTypes: [...baseCase.observed.evidenceTypes, "market_status"],
          },
        },
      ],
    });

    expect(report.summary).toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(report.cases[0]?.warnings).toContainEqual(
      expect.objectContaining({
        field: "evidenceTypes",
      }),
    );
  });

  it("allows explicit manifest-accepted scalar owner changes while preserving unlisted failures", () => {
    const report = comparePromptPolicyReports({
      baseLabel: "before",
      currentLabel: "current",
      baseCases: [
        {
          ...baseCase,
          id: "macro-portfolio-review",
          observed: {
            ...baseCase.observed,
            taskFamily: "macro_allocation_review",
            policyCardId: "portfolio_review",
            answerContractId: "portfolio_review",
          },
        },
      ],
      currentCases: [
        {
          ...baseCase,
          id: "macro-portfolio-review",
          acceptedObservedChanges: [
            {
              field: "policyCardId",
              from: "portfolio_review",
              to: "macro_allocation_review",
              reason: "macro allocation owner promotion",
            },
            {
              field: "answerContractId",
              from: "portfolio_review",
              to: "macro_allocation_review",
              reason: "macro allocation owner promotion",
            },
          ],
          observed: {
            ...baseCase.observed,
            taskFamily: "macro_allocation_review",
            policyCardId: "macro_allocation_review",
            answerContractId: "macro_allocation_review",
          },
        },
      ],
    });

    expect(report.summary).toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(report.cases[0]?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "policyCardId" }),
        expect.objectContaining({ field: "answerContractId" }),
      ]),
    );
  });
});
