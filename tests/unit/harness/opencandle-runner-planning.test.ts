import { describe, expect, it } from "vitest";
import { toEvalTrace } from "../../harness/opencandle-runner.js";
import type { AgentTrace } from "../../harness/types.js";

describe("OpenCandle harness planning telemetry", () => {
  it("extends eval traces with planning, minimal evidence, structured checks, and retry eligibility", () => {
    const agentTrace: AgentTrace = {
      prompt: "Why did BA move today after close?",
      turns: [{
        text: "answer",
        toolCalls: [{
          name: "get_stock_quote",
          args: { symbol: "BA" },
          result: { symbol: "BA", price: 180 },
          isError: false,
          durationMs: 10,
        }],
      }],
      interactions: [],
      finalText: "answer",
      toolSequence: ["get_stock_quote"],
      durationMs: 100,
      customEntries: [{
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
      }],
    };

    const trace = toEvalTrace(agentTrace);

    expect(trace.planning).toEqual(expect.objectContaining({
      version: "planning-v1",
      taskFamily: "current_event_explanation",
      policyCardId: "current_event_explanation",
      evidencePlanId: "market_status",
      answerContractId: "current_event_explanation",
      workspacePlaceholderIds: ["research_workspace_v1_placeholder"],
      artifactPlaceholderIds: ["artifact_source_coverage_placeholder"],
      artifactContractIds: ["source_coverage_table"],
      capabilityGapIds: ["market_calendar"],
    }));
    expect(trace.planning?.evidenceRecords.some((record) => record.evidenceType === "market_status")).toBe(true);
    expect(trace.planning?.evidenceRecords.some((record) => record.rawTracePointer?.toolName === "get_stock_quote")).toBe(true);
    expect(trace.planning?.structuredCheckFailures.map((failure) => failure.checkId)).toContain("freshness_disclosed");
    expect(trace.planning?.retryEligibility.activeRetryAllowed).toBe(false);
  });

  it("infers framework final-answer fields for concept education traces", () => {
    const agentTrace: AgentTrace = {
      prompt: "Explain covered calls for a beginner.",
      turns: [{ text: "answer", toolCalls: [] }],
      interactions: [],
      finalText: "Bottom line: covered calls are income for capped upside.\n\nHow it works:\n- You sell a call.\n\nMain risks:\n- Assignment risk.",
      toolSequence: [],
      durationMs: 100,
      customEntries: [{
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
      }],
    };

    const trace = toEvalTrace(agentTrace);

    expect(trace.planning?.structuredCheckFailures).toEqual([]);
    expect(trace.planning?.retryEligibility.eligible).toBe(false);
  });
});
