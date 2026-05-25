import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
  type AuthStorage,
  type ModelRegistry,
  SessionManager as PiSessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAnalysisRequest } from "../../src/analysts/orchestrator.js";
import { cache } from "../../src/infra/cache.js";
import { createOpenCandleSession } from "../../src/index.js";
import {
  ANSWER_CONTRACT_REGISTRY,
  type FinalAnswerField,
  runStructuredChecks,
} from "../../src/runtime/answer-contracts.js";
import {
  buildMarketStatusEvidence,
  buildTickerDisambiguationEvidence,
  captureEvidenceFromToolCall,
} from "../../src/runtime/planning-evidence.js";
import type { ArtifactContractId } from "../../src/runtime/artifact-contracts.js";
import { classifyIntent } from "../../src/routing/classify-intent.js";
import type {
  AnswerContractId,
  CapabilityGapId,
  CommitmentMode,
  StructuredCheckId,
} from "../../src/routing/planning.js";
import type { ClassificationResult, ExtractedEntities, WorkflowType } from "../../src/routing/types.js";
import type { AskUserHandler } from "../../src/types/index.js";
import type { EvalTrace, PlanningTelemetry, TraceToolCall } from "../evals/types.js";
import { createTraceCollector, type TraceCollector } from "./trace-collector.js";
import type { AgentTrace, CustomEntryTrace, InteractionTrace } from "./types.js";

const MULTI_STEP_WORKFLOWS = new Set<WorkflowType>([
  "options_screener",
  "portfolio_builder",
  "compare_assets",
]);

export interface RunOpenCandleSessionOptions {
  prompt: string;
  scriptedAnswers?: string[];
  cwd?: string;
  openCandleHome?: string;
  settleGraceMs?: number;
  timeoutMs?: number;
  jsonlPath?: string;
  defaultProvider?: string;
  defaultModel?: string;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
}

export interface RunOpenCandleSessionResult {
  agentTrace: AgentTrace;
  evalTrace: EvalTrace;
}

export async function runOpenCandleSession(
  options: RunOpenCandleSessionOptions,
): Promise<RunOpenCandleSessionResult> {
  const openCandleHome = options.openCandleHome ?? mkdtempSync(join(tmpdir(), "oc-harness-home-"));
  const shouldRemoveOpenCandleHome = options.openCandleHome === undefined;
  const previousHome = process.env.OPENCANDLE_HOME;
  process.env.OPENCANDLE_HOME = openCandleHome;

  let collector: TraceCollector | null = null;
  let session:
    | Awaited<ReturnType<typeof createOpenCandleSession>>["session"]
    | null = null;

  try {
    const collectorProxy: Pick<TraceCollector, "addInteraction"> = {
      addInteraction: (...args: Parameters<TraceCollector["addInteraction"]>) => {
        collector?.addInteraction(...args);
      },
    };

    const askUserHandler = createScriptedAskHandler(
      options.scriptedAnswers ?? [],
      collectorProxy,
    );

    const created = await createOpenCandleSession({
      cwd: options.cwd ?? process.cwd(),
      authStorage: options.authStorage,
      modelRegistry: options.modelRegistry,
      sessionManager: PiSessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory({
        defaultProvider: options.defaultProvider ?? "google",
        defaultModel: options.defaultModel ?? "gemini-2.5-flash",
      }),
      useInlineExtension: true,
      askUserHandler,
    });
    session = created.session;

    collector = createTraceCollector(session, options.prompt, {
      jsonlPath: options.jsonlPath,
    });

    cache.clear();
    await promptAndWaitForSettle(session, options.prompt, {
      settleGraceMs: options.settleGraceMs ?? defaultSettleGraceMs(options.prompt),
      timeoutMs: options.timeoutMs ?? 900_000,
    });

    const customEntries = drainOpenCandleCustomEntries(session.sessionManager);
    const agentTrace: AgentTrace = {
      ...collector.getTrace(),
      customEntries,
    };
    return {
      agentTrace,
      evalTrace: toEvalTrace(agentTrace),
    };
  } finally {
    collector?.dispose();
    session?.dispose();
    if (shouldRemoveOpenCandleHome) {
      rmSync(openCandleHome, { recursive: true, force: true });
    }
    if (previousHome === undefined) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = previousHome;
    }
  }
}

export function drainOpenCandleCustomEntries(
  sessionManager: Pick<ReturnType<typeof PiSessionManager.inMemory>, "getEntries">,
): CustomEntryTrace[] {
  return sessionManager
    .getEntries()
    .filter((entry) => entry.type === "custom" && entry.customType.startsWith("opencandle-"))
    .map((entry) => {
      const customEntry = entry as Extract<
        ReturnType<typeof sessionManager.getEntries>[number],
        { type: "custom" }
      >;
      return {
        customType: customEntry.customType,
        data: customEntry.data,
        timestamp: customEntry.timestamp,
      };
    });
}

export function toEvalTrace(agentTrace: AgentTrace): EvalTrace {
  const toolCalls = agentTrace.turns.flatMap((turn) =>
    turn.toolCalls.map(
      (tool): TraceToolCall => ({
        name: tool.name,
        args: tool.args,
        result: tool.result,
      }),
    ),
  );
  return {
    prompt: agentTrace.prompt,
    classification: classificationFromTrace(agentTrace),
    router: routerTelemetryFromTrace(agentTrace),
    planning: planningTelemetryFromTrace(agentTrace, toolCalls, agentTrace.finalText || agentTrace.turns.map((turn) => turn.text).join("")),
    toolCalls,
    askUserTranscript: agentTrace.interactions.map((interaction) => ({
      question: interaction.question,
      answer: interaction.answer,
    })),
    text: agentTrace.finalText || agentTrace.turns.map((turn) => turn.text).join(""),
    customEntries: agentTrace.customEntries,
  };
}

function createScriptedAskHandler(
  scriptedAnswers: string[],
  traceCollector: Pick<TraceCollector, "addInteraction">,
): AskUserHandler {
  let scriptedIndex = 0;
  return async (params) => {
    const answer = scriptedIndex < scriptedAnswers.length
      ? scriptedAnswers[scriptedIndex++]
      : null;
    const interaction: InteractionTrace = {
      question: params.question,
      method: params.questionType,
      options: params.options,
      answer,
    };
    traceCollector.addInteraction(interaction);
    return {
      answer,
      cancelled: answer === null,
    };
  };
}

async function promptAndWaitForSettle(
  session: Awaited<ReturnType<typeof createOpenCandleSession>>["session"],
  prompt: string,
  options: { settleGraceMs: number; timeoutMs: number },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let unsub = () => {};
    const timeoutTimer = setTimeout(() => {
      cleanup();
      reject(new Error(`OpenCandle harness timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      unsub();
    };

    const cancelSettle = () => {
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
    };

    const finishAfterGrace = () => {
      cancelSettle();
      settleTimer = setTimeout(() => {
        cleanup();
        resolve();
      }, options.settleGraceMs);
    };

    unsub = session.subscribe((event: AgentSessionEvent) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        cancelSettle();
      }
      if (event.type === "tool_execution_start") {
        cancelSettle();
      }
      if (event.type === "agent_end") {
        finishAfterGrace();
      }
    });

    void session.prompt(prompt).catch((error: unknown) => {
      cleanup();
      reject(error);
    });
  });
}

function defaultSettleGraceMs(prompt: string): number {
  const classification = classifyIntent(prompt);
  return isAnalysisRequest(prompt).match || MULTI_STEP_WORKFLOWS.has(classification.workflow)
    ? 30_000
    : 3_000;
}

function classificationFromTrace(agentTrace: AgentTrace): ClassificationResult {
  const routerEntry = [...(agentTrace.customEntries ?? [])]
    .reverse()
    .find((entry) => entry.customType === "opencandle-router");
  const output = routerEntry ? getRouterOutput(routerEntry.data) : null;
  if (output) {
    return {
      workflow: output.workflow ?? "unclassified",
      confidence: confidenceToNumber(output.confidence),
      tier: "llm",
      entities: output.entities ?? { symbols: [] },
    };
  }
  return classifyIntent(agentTrace.prompt);
}

function routerTelemetryFromTrace(agentTrace: AgentTrace): EvalTrace["router"] {
  const customEntries = agentTrace.customEntries ?? [];
  const routerEntry = [...customEntries]
    .reverse()
    .find((entry) => entry.customType === "opencandle-router");
  const routeContextEntry = [...customEntries]
    .reverse()
    .find((entry) => entry.customType === "opencandle-route-context");
  const scopeEntries = customEntries
    .filter((entry) => entry.customType === "opencandle-tool-scope")
    .map((entry) => entry.data);
  const violations = customEntries
    .filter((entry) => entry.customType === "opencandle-tool-scope-violation")
    .map((entry) => entry.data);

  const routerOutput = routerEntry ? getRouterOutputRecord(routerEntry.data) : null;
  const routeContext = isRecord(routeContextEntry?.data) ? routeContextEntry.data : null;
  const memoryQueryPlan = isRecord(routeContext?.memoryQueryPlan)
    ? routeContext.memoryQueryPlan
    : null;

  return {
    routeKind: stringOrUndefined(routeContext?.routeKind ?? routerOutput?.routeKind),
    legacyRoute: stringOrUndefined(routeContext?.legacyRoute ?? routerOutput?.route),
    workflow: stringOrUndefined(routeContext?.workflow ?? routerOutput?.workflow),
    missingRequired: stringArrayOrUndefined(routeContext?.missingRequired ?? routerOutput?.missing_required),
    toolBundles: stringArrayOrUndefined(routeContext?.toolBundles ?? routerOutput?.tool_bundles),
    activeToolNames: stringArrayOrUndefined(routeContext?.activeToolNames),
    memoryCategories: stringArrayOrUndefined(memoryQueryPlan?.categories),
    memoryProvenance: Array.isArray(routeContext?.memoryProvenance)
      ? routeContext.memoryProvenance
      : undefined,
    diagnostics: Array.isArray(routeContext?.diagnostics ?? routerOutput?.diagnostics)
      ? (routeContext?.diagnostics ?? routerOutput?.diagnostics) as unknown[]
      : undefined,
    toolScopeViolations: violations.length > 0 ? violations : undefined,
    ...(scopeEntries.length > 0 ? { toolScope: scopeEntries } : {}),
  };
}

function planningTelemetryFromTrace(
  agentTrace: AgentTrace,
  toolCalls: TraceToolCall[],
  finalText: string,
): PlanningTelemetry | undefined {
  const routeContext = latestRouteContext(agentTrace);
  const planning = isRecord(routeContext?.planning) ? routeContext.planning : null;
  if (!planning) return undefined;

  const evidencePlanId = stringOrUndefined(planning.evidencePlanId);
  const taskFamily = stringOrUndefined(planning.taskFamily);
  const commitmentMode = commitmentModeOrUndefined(planning.commitmentMode);
  const answerContractId = answerContractIdOrUndefined(planning.answerContractId);
  const capabilityGapIds = capabilityGapArrayOrEmpty(planning.capabilityGapIds);
  const symbols = isRecord(routeContext?.entities)
    ? stringArrayOrUndefined(routeContext.entities.symbols) ?? []
    : [];
  const evidenceRecords = [
    ...plannedEvidenceRecords({
      prompt: agentTrace.prompt,
      evidencePlanId,
      symbols,
    }),
    ...toolCalls.map((toolCall, index) => captureEvidenceFromToolCall({
      name: toolCall.name,
      args: toolCall.args,
      result: toolCall.result,
      isError: false,
    }, {
      traceId: "eval-trace",
      toolCallIndex: index,
    })),
  ];

  const contract = answerContractId ? ANSWER_CONTRACT_REGISTRY[answerContractId] : undefined;
  const structuredTrace = contract && commitmentMode
    ? runStructuredChecks({
      contract,
      evidenceRecords,
      finalAnswerMetadata: {
        commitmentMode,
        finalFields: inferFinalAnswerFieldsForEval(finalText),
      },
    })
    : undefined;

  return {
    version: stringOrUndefined(planning.version),
    taskFamily,
    commitmentMode,
    policyCardId: stringOrUndefined(planning.policyCardId),
    evidencePlanId,
    answerContractId,
    structuredCheckIds: structuredCheckArrayOrEmpty(planning.structuredCheckIds),
    workspacePlaceholderIds: stringArrayOrUndefined(planning.workspacePlaceholderIds) ?? [],
    artifactPlaceholderIds: stringArrayOrUndefined(planning.artifactPlaceholderIds) ?? [],
    artifactContractIds: artifactContractArrayOrEmpty(planning.artifactContractIds),
    capabilityGapIds,
    evidenceRecords,
    structuredCheckResults: structuredTrace?.results ?? [],
    structuredCheckFailures: structuredTrace?.failures ?? [],
    retryEligibility: structuredTrace?.retryEligibility ?? {
      eligible: false,
      activeRetryAllowed: false,
      reasons: [],
    },
    parityStatus: "legacy_active",
    regressionClassification: "none",
  };
}

function inferFinalAnswerFieldsForEval(text: string): FinalAnswerField[] {
  const lower = text.toLowerCase();
  const fields: FinalAnswerField[] = [];
  if (/\b(bottom line|framework|checklist|workflow|how it works|mental model|main risks?|steps?)\b/.test(lower)) {
    fields.push("framework_or_checklist");
  }
  if (/\b(risk|downside|trade[- ]?off|caveat|uncertain|loss|not ideal)\b/.test(lower)) {
    fields.push("risk_downside");
  }
  if (/\b(compare|versus|vs\.?|trade[- ]?offs?|better fit|prefer)\b/.test(lower)) {
    fields.push("comparison_tradeoffs");
  }
  if (/\b(buy|sell|hold|avoid|trim|add|recommend|bottom line: (?:yes|no))\b/.test(lower)) {
    fields.push("clear_commitment");
  }
  if (/\b(unavailable|missing|data gap|cannot verify|not available|no live|unknown)\b/.test(lower)) {
    fields.push("data_gap_disclosure");
  }
  if (/\b(as of|market closed|last trading day|freshness|quote date)\b/.test(lower)) {
    fields.push("freshness_disclosure");
  }
  if (/\b(source|coverage|filing|news|reddit|twitter|x\/twitter)\b/.test(lower)) {
    fields.push("source_coverage");
  }
  if (/\b(confirmed|saved|recorded|updated|tracked)\b/.test(lower)) {
    fields.push("state_update_confirmation");
  }
  if (/\?\s*$|\b(what is your|which symbol|please clarify|need your)\b/.test(lower)) {
    fields.push("clarifying_question");
  }
  if (/\b(ticker|symbol|could not verify|not verified)\b/.test(lower)) {
    fields.push("symbol_verification_disclosure");
  }
  if (/\b(portfolio|allocation|allocate|sleeve|target weight)\b/.test(lower)) {
    fields.push("constructed_output");
  }
  return [...new Set(fields)];
}

function latestRouteContext(agentTrace: AgentTrace): Record<string, unknown> | null {
  const entry = [...(agentTrace.customEntries ?? [])]
    .reverse()
    .find((candidate) => candidate.customType === "opencandle-route-context");
  return isRecord(entry?.data) ? entry.data : null;
}

function plannedEvidenceRecords(options: {
  prompt: string;
  evidencePlanId?: string;
  symbols: string[];
}) {
  if (options.evidencePlanId === "market_status") {
    return [buildMarketStatusEvidence({
      text: options.prompt,
      traceId: "eval-trace",
    })];
  }
  if (options.evidencePlanId === "ticker_disambiguation") {
    return [buildTickerDisambiguationEvidence({
      text: options.prompt,
      symbols: options.symbols,
      traceId: "eval-trace",
    })];
  }
  return [];
}

function getRouterOutput(data: unknown): {
  workflow?: WorkflowType;
  confidence?: unknown;
  entities?: ExtractedEntities;
} | null {
  const output = getRouterOutputRecord(data);
  if (!output) return null;
  const workflow = typeof output.workflow === "string" && isWorkflowType(output.workflow)
    ? output.workflow
    : undefined;
  const entities = isRecord(output.entities)
    ? {
      ...output.entities,
      symbols: Array.isArray(output.entities.symbols)
        ? output.entities.symbols.filter((symbol): symbol is string => typeof symbol === "string")
        : [],
    } as ExtractedEntities
    : { symbols: [] };
  return {
    workflow,
    confidence: output.confidence,
    entities,
  };
}

function getRouterOutputRecord(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data)) return null;
  const output = data.output;
  if (!isRecord(output)) return null;
  return output;
}

function confidenceToNumber(confidence: unknown): number {
  if (typeof confidence === "number" && Number.isFinite(confidence)) return confidence;
  if (confidence === "high") return 0.9;
  if (confidence === "medium") return 0.6;
  if (confidence === "low") return 0.3;
  return 0.5;
}

function isWorkflowType(value: string): value is WorkflowType {
  return value === "single_asset_analysis" ||
    value === "portfolio_builder" ||
    value === "options_screener" ||
    value === "compare_assets" ||
    value === "watchlist_or_tracking" ||
    value === "general_finance_qa" ||
    value === "unclassified";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArrayOrUndefined(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function structuredCheckArrayOrEmpty(value: unknown): StructuredCheckId[] {
  const allowed = new Set<StructuredCheckId>([
    "required_evidence_present",
    "freshness_disclosed",
    "data_gap_disclosed",
    "commitment_mode_respected",
    "source_coverage_disclosed",
    "capability_gap_disclosure",
  ]);
  return (stringArrayOrUndefined(value) ?? []).filter((item): item is StructuredCheckId =>
    allowed.has(item as StructuredCheckId)
  );
}

function capabilityGapArrayOrEmpty(value: unknown): CapabilityGapId[] {
  const allowed = new Set<CapabilityGapId>([
    "market_calendar",
    "etf_holdings_overlap",
    "brokerage_comparison",
    "cash_yield_products",
    "earnings_event_risk",
    "fund_tax_efficiency",
    "forward_rate_probabilities",
    "sentiment_sample_depth",
  ]);
  return (stringArrayOrUndefined(value) ?? []).filter((item): item is CapabilityGapId =>
    allowed.has(item as CapabilityGapId)
  );
}

function artifactContractArrayOrEmpty(value: unknown): ArtifactContractId[] {
  const allowed = new Set([
    "concept_example_table",
    "portfolio_exposure_map",
    "rebalance_action_plan",
    "source_coverage_table",
  ]);
  return (stringArrayOrUndefined(value) ?? []).filter((item): item is ArtifactContractId => allowed.has(item));
}

function commitmentModeOrUndefined(value: unknown): CommitmentMode | undefined {
  return value === "decision" ||
    value === "compare_tradeoffs" ||
    value === "framework" ||
    value === "construct" ||
    value === "update_state" ||
    value === "clarify"
    ? value
    : undefined;
}

function answerContractIdOrUndefined(value: unknown): AnswerContractId | undefined {
  if (typeof value !== "string") return undefined;
  return value in ANSWER_CONTRACT_REGISTRY ? value as AnswerContractId : undefined;
}
