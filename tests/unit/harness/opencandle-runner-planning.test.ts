import { describe, expect, it } from "vitest";
import { toEvalTrace } from "../../harness/opencandle-runner.js";
import type { AgentTrace } from "../../harness/types.js";

describe("OpenCandle harness planning telemetry", () => {
  it("extends eval traces with planning, minimal evidence, structured checks, and retry eligibility", () => {
    const agentTrace: AgentTrace = {
      prompt: "Why did BA move today after close?",
      turns: [
        {
          text: "answer",
          toolCalls: [
            {
              name: "get_stock_quote",
              args: { symbol: "BA" },
              result: { symbol: "BA", price: 180 },
              isError: false,
              durationMs: 10,
            },
          ],
        },
      ],
      interactions: [],
      finalText: "answer",
      toolSequence: ["get_stock_quote"],
      durationMs: 100,
      customEntries: [
        {
          customType: "opencandle-route-context",
          timestamp: "2026-05-24T00:00:00.000Z",
          data: {
            routeKind: "agent_task",
            legacyRoute: "fallback",
            workflow: "general_finance_qa",
            entities: { symbols: ["BA"] },
            toolBundles: ["core_market"],
            activeToolNames: ["get_stock_quote"],
            memoryQueryPlan: { categories: [] },
            diagnostics: [],
            planning: {
              version: "planning-v1",
              behaviorMode: "observe_only",
              taskFamily: "current_event_explanation",
              commitmentMode: "framework",
              policyCardId: "current_event_explanation",
              evidencePlanId: "market_status",
              answerContractId: "current_event_explanation",
              structuredCheckIds: ["required_evidence_present", "freshness_disclosed"],
              workspacePlaceholderIds: ["research_workspace_v1_placeholder"],
              artifactPlaceholderIds: ["artifact_source_coverage_placeholder"],
              artifactContractIds: ["source_coverage_table"],
              capabilityGapIds: ["market_calendar"],
              diagnostics: [],
            },
          },
        },
      ],
    };

    const trace = toEvalTrace(agentTrace);

    expect(trace.planning).toEqual(
      expect.objectContaining({
        version: "planning-v1",
        taskFamily: "current_event_explanation",
        policyCardId: "current_event_explanation",
        evidencePlanId: "market_status",
        answerContractId: "current_event_explanation",
        workspacePlaceholderIds: ["research_workspace_v1_placeholder"],
        artifactPlaceholderIds: ["artifact_source_coverage_placeholder"],
        artifactContractIds: ["source_coverage_table"],
        capabilityGapIds: ["market_calendar"],
      }),
    );
    expect(
      trace.planning?.evidenceRecords.some((record) => record.evidenceType === "market_status"),
    ).toBe(true);
    expect(
      trace.planning?.evidenceRecords.some(
        (record) => record.rawTracePointer?.toolName === "get_stock_quote",
      ),
    ).toBe(true);
    expect(trace.planning?.structuredCheckFailures.map((failure) => failure.checkId)).toContain(
      "freshness_disclosed",
    );
    expect(trace.planning?.retryEligibility.activeRetryAllowed).toBe(false);
  });

  it("infers framework final-answer fields for concept education traces", () => {
    const agentTrace: AgentTrace = {
      prompt: "Explain covered calls for a beginner.",
      turns: [{ text: "answer", toolCalls: [] }],
      interactions: [],
      finalText:
        "Bottom line: covered calls are income for capped upside.\n\nHow it works:\n- You sell a call.\n\nMain risks:\n- Assignment risk.",
      toolSequence: [],
      durationMs: 100,
      customEntries: [
        {
          customType: "opencandle-route-context",
          timestamp: "2026-05-24T00:00:00.000Z",
          data: {
            routeKind: "agent_task",
            legacyRoute: "fallback",
            workflow: "general_finance_qa",
            entities: { symbols: [] },
            toolBundles: [],
            activeToolNames: [],
            memoryQueryPlan: { categories: [] },
            diagnostics: [],
            planning: {
              version: "planning-v1",
              behaviorMode: "replacement_active",
              taskFamily: "concept_explainer",
              commitmentMode: "framework",
              policyCardId: "concept_options_education",
              evidencePlanId: "placeholder_concept_explainer",
              answerContractId: "concept_explainer",
              structuredCheckIds: ["commitment_mode_respected"],
              workspacePlaceholderIds: [],
              artifactPlaceholderIds: [],
              capabilityGapIds: [],
              diagnostics: [],
            },
          },
        },
      ],
    };

    const trace = toEvalTrace(agentTrace);

    expect(trace.planning?.structuredCheckFailures).toEqual([]);
    expect(trace.planning?.retryEligibility.eligible).toBe(false);
  });

  it("does not infer sentiment rationale from generic findings headings", () => {
    const agentTrace: AgentTrace = {
      prompt: "What is sentiment around NVDA?",
      turns: [{ text: "answer", toolCalls: [] }],
      interactions: [],
      finalText:
        "Findings: source coverage used Reddit and Twitter. Confidence is low because sample size is thin.",
      toolSequence: [],
      durationMs: 100,
      customEntries: [
        {
          customType: "opencandle-route-context",
          timestamp: "2026-05-24T00:00:00.000Z",
          data: {
            routeKind: "agent_task",
            legacyRoute: "fallback",
            workflow: "general_finance_qa",
            entities: { symbols: ["NVDA"] },
            toolBundles: [],
            activeToolNames: [],
            memoryQueryPlan: { categories: [] },
            diagnostics: [],
            planning: {
              version: "planning-v1",
              behaviorMode: "observe_only",
              taskFamily: "sentiment_snapshot",
              commitmentMode: "framework",
              policyCardId: "sentiment_snapshot",
              evidencePlanId: "placeholder_sentiment_snapshot",
              answerContractId: "sentiment_snapshot",
              structuredCheckIds: ["commitment_mode_respected"],
              workspacePlaceholderIds: [],
              artifactPlaceholderIds: [],
              capabilityGapIds: ["sentiment_sample_depth"],
              diagnostics: [],
            },
          },
        },
      ],
    };

    const trace = toEvalTrace(agentTrace);

    expect(trace.planning?.structuredCheckFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "required_final_fields_present",
          failureReason: expect.stringContaining("sentiment_rationale"),
        }),
      ]),
    );
  });

  it("infers sentiment rationale from explicit driver evidence", () => {
    const agentTrace: AgentTrace = {
      prompt: "What is sentiment around NVDA?",
      turns: [{ text: "answer", toolCalls: [] }],
      interactions: [],
      finalText:
        "Bottom line: source coverage used Reddit and Twitter with a data gap from low sample size. " +
        "Positive drivers: datacenter demand and AI order momentum. Confidence is medium with caveats.",
      toolSequence: [],
      durationMs: 100,
      customEntries: [
        {
          customType: "opencandle-route-context",
          timestamp: "2026-05-24T00:00:00.000Z",
          data: {
            routeKind: "agent_task",
            legacyRoute: "fallback",
            workflow: "general_finance_qa",
            entities: { symbols: ["NVDA"] },
            toolBundles: [],
            activeToolNames: [],
            memoryQueryPlan: { categories: [] },
            diagnostics: [],
            planning: {
              version: "planning-v1",
              behaviorMode: "observe_only",
              taskFamily: "sentiment_snapshot",
              commitmentMode: "framework",
              policyCardId: "sentiment_snapshot",
              evidencePlanId: "placeholder_sentiment_snapshot",
              answerContractId: "sentiment_snapshot",
              structuredCheckIds: ["commitment_mode_respected"],
              workspacePlaceholderIds: [],
              artifactPlaceholderIds: [],
              capabilityGapIds: ["sentiment_sample_depth"],
              diagnostics: [],
            },
          },
        },
      ],
    };

    const trace = toEvalTrace(agentTrace);

    expect(trace.planning?.structuredCheckFailures).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checkId: "required_final_fields_present" }),
      ]),
    );
  });

  it("adds portfolio exposure-map evidence for portfolio rebalance planning traces", () => {
    const agentTrace: AgentTrace = {
      prompt: "I have 45% tech, 25% S&P 500 index, 20% bonds, and 10% cash. Should I rebalance?",
      turns: [{ text: "answer", toolCalls: [] }],
      interactions: [],
      finalText:
        "Bottom line: assuming your stated allocation is current, rebalance toward 5% target bands. " +
        "Based on your stated percentages, exact ETF holdings overlap is not verified and tax costs depend on account type.",
      toolSequence: [],
      durationMs: 100,
      customEntries: [
        {
          customType: "opencandle-route-context",
          timestamp: "2026-05-24T00:00:00.000Z",
          data: {
            routeKind: "agent_task",
            legacyRoute: "fallback",
            workflow: "general_finance_qa",
            entities: { symbols: [] },
            toolBundles: [],
            activeToolNames: [],
            memoryQueryPlan: { categories: [] },
            diagnostics: [],
            planning: {
              version: "planning-v1",
              behaviorMode: "replacement_active",
              taskFamily: "portfolio_review",
              commitmentMode: "decision",
              policyCardId: "portfolio_rebalance_review",
              evidencePlanId: "placeholder_portfolio_review",
              answerContractId: "portfolio_review",
              structuredCheckIds: ["required_evidence_present"],
              workspacePlaceholderIds: [],
              artifactPlaceholderIds: [],
              artifactContractIds: ["portfolio_exposure_map", "rebalance_action_plan"],
              capabilityGapIds: ["etf_holdings_overlap"],
              diagnostics: [],
            },
          },
        },
      ],
    };

    const trace = toEvalTrace(agentTrace);

    expect(trace.planning?.evidenceRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceType: "portfolio_exposure_map",
          normalizedFacts: expect.objectContaining({
            broadIndexOverlapCaveat: true,
            targetBandGuidanceNeeded: true,
          }),
        }),
      ]),
    );
    expect(trace.planning?.structuredCheckFailures.map((failure) => failure.checkId)).not.toEqual(
      expect.arrayContaining([
        "data_gap_disclosed",
        "source_coverage_disclosed",
        "capability_gap_disclosure",
        "assumption_disclosed",
        "target_bands_present",
      ]),
    );
  });
});
