import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
  type ModelRuntime,
  SessionManager as PiSessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { isAnalysisRequest } from "../../src/analysts/orchestrator.js";
import { createOpenCandleSession } from "../../src/index.js";
import { cache } from "../../src/infra/cache.js";
import type {
  AnswerContractId,
  CapabilityGapId,
  CommitmentMode,
  StructuredCheckId,
} from "../../src/routing/planning.js";
import type {
  ClassificationResult,
  ExtractedEntities,
  WorkflowType,
} from "../../src/routing/types.js";
import type { AskUserHandler } from "../../src/types/index.js";
import type { EvalTrace, PlanningTelemetry, TraceToolCall } from "../evals/types.js";
import {
  buildMarketStatusEvidence,
  buildPortfolioExposureMapEvidence,
  buildTickerDisambiguationEvidence,
  captureEvidenceFromToolCall,
  type PlanningEvidenceRecord,
} from "./planning-evidence.js";
import { assertSessionCompleted, failSessionCompletion } from "./session-completion.js";
import {
  ANSWER_CONTRACT_REGISTRY,
  type FinalAnswerField,
  runStructuredChecks,
} from "./structured-checks.js";
import { classifyTerminalError } from "./terminal-outcome.js";
import { createTraceCollector, type TraceCollector } from "./trace-collector.js";
import type { AgentTrace, CustomEntryTrace, InteractionTrace } from "./types.js";

const MULTI_STEP_WORKFLOWS = new Set<WorkflowType>([
  "options_screener",
  "portfolio_builder",
  "compare_assets",
]);

/** Workflow labels the extension can dispatch and name in a workflow entry. */
const DISPATCHABLE_WORKFLOW_LABELS = new Set<WorkflowType>([
  "options_screener",
  "portfolio_builder",
  "compare_assets",
  "single_asset_analysis",
  "watchlist_or_tracking",
  "general_finance_qa",
]);

export interface RunOpenCandleSessionOptions {
  prompt?: string;
  prompts?: string[];
  scriptedAnswers?: string[];
  cwd?: string;
  openCandleHome?: string;
  settleGraceMs?: number;
  timeoutMs?: number;
  jsonlPath?: string;
  defaultProvider?: string;
  defaultModel?: string;
  modelRuntime?: ModelRuntime;
  /** Optional canonical Pi session to continue, including an imported hosted JSONL session. */
  sessionManager?: PiSessionManager;
}

export interface RunOpenCandleSessionResult {
  agentTrace: AgentTrace;
  evalTrace: EvalTrace;
}

export async function runOpenCandleSession(
  options: RunOpenCandleSessionOptions,
): Promise<RunOpenCandleSessionResult> {
  const prompts = normalizePrompts(options);
  const tagsPromptIndex = options.prompts !== undefined;
  const openCandleHome = options.openCandleHome ?? mkdtempSync(join(tmpdir(), "oc-harness-home-"));
  const shouldRemoveOpenCandleHome = options.openCandleHome === undefined;
  const previousHome = process.env.OPENCANDLE_HOME;
  process.env.OPENCANDLE_HOME = openCandleHome;

  let collector: TraceCollector | null = null;
  let session: Awaited<ReturnType<typeof createOpenCandleSession>>["session"] | null = null;

  try {
    const collectorProxy: Pick<TraceCollector, "addInteraction"> = {
      addInteraction: (...args: Parameters<TraceCollector["addInteraction"]>) => {
        collector?.addInteraction(...args);
      },
    };

    const askUserHandler = createScriptedAskHandler(options.scriptedAnswers ?? [], collectorProxy);

    const created = await createOpenCandleSession({
      cwd: options.cwd ?? process.cwd(),
      modelRuntime: options.modelRuntime,
      sessionManager: options.sessionManager ?? PiSessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory({
        defaultProvider: options.defaultProvider ?? "google",
        defaultModel: options.defaultModel ?? "gemini-2.5-flash",
      }),
      useInlineExtension: true,
      askUserHandler,
    });
    session = created.session;

    collector = createTraceCollector(session, prompts[0], {
      jsonlPath: options.jsonlPath,
      trackPromptIndex: tagsPromptIndex,
    });

    cache.clear();
    const customEntries: CustomEntryTrace[] = [];
    let customEntryOffset = 0;
    for (const [promptIndex, prompt] of prompts.entries()) {
      collector.setPromptIndex(promptIndex);
      const sessionManager = session.sessionManager;
      try {
        await promptAndWaitForSettle(session, prompt, {
          resolveSettleGraceMs: () =>
            options.settleGraceMs ?? settleGraceMsForTurn(prompt, sessionManager),
          timeoutMs: options.timeoutMs ?? 900_000,
        });
      } catch (error) {
        failSessionCompletion(
          collector.getTrace(),
          classifyTerminalError(error instanceof Error ? error.message : undefined, undefined),
        );
      }
      const drained = drainOpenCandleCustomEntries(
        session.sessionManager,
        customEntryOffset,
        tagsPromptIndex ? promptIndex : undefined,
      );
      customEntries.push(...drained.entries);
      customEntryOffset = drained.nextEntryOffset;
      assertSessionCompleted({ ...collector.getTrace(), customEntries: drained.entries });
    }

    const agentTrace: AgentTrace = {
      ...collector.getTrace(),
      ...(tagsPromptIndex ? { prompts } : {}),
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
  startEntryOffset?: undefined,
  promptIndex?: number,
): CustomEntryTrace[];
export function drainOpenCandleCustomEntries(
  sessionManager: Pick<ReturnType<typeof PiSessionManager.inMemory>, "getEntries">,
  startEntryOffset: number,
  promptIndex?: number,
): { entries: CustomEntryTrace[]; nextEntryOffset: number };
export function drainOpenCandleCustomEntries(
  sessionManager: Pick<ReturnType<typeof PiSessionManager.inMemory>, "getEntries">,
  startEntryOffset?: number,
  promptIndex?: number,
): CustomEntryTrace[] | { entries: CustomEntryTrace[]; nextEntryOffset: number } {
  const allEntries = sessionManager.getEntries();
  const entries = allEntries
    .slice(startEntryOffset ?? 0)
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
        ...(promptIndex === undefined ? {} : { promptIndex }),
      };
    });
  if (startEntryOffset === undefined) return entries;
  return { entries, nextEntryOffset: allEntries.length };
}

export function toEvalTrace(agentTrace: AgentTrace): EvalTrace {
  const toolCalls = agentTrace.turns.flatMap((turn) =>
    turn.toolCalls.map(
      (tool): TraceToolCall => ({
        name: tool.name,
        args: tool.args,
        result: tool.result,
        isError: tool.isError,
        ...(tool.promptIndex === undefined ? {} : { promptIndex: tool.promptIndex }),
      }),
    ),
  );
  return {
    prompt: agentTrace.prompt,
    classification: classificationFromTrace(agentTrace),
    router: routerTelemetryFromTrace(agentTrace),
    planning: planningTelemetryFromTrace(
      agentTrace,
      toolCalls,
      agentTrace.finalText || agentTrace.turns.map((turn) => turn.text).join(""),
    ),
    toolCalls,
    askUserTranscript: agentTrace.interactions.map((interaction) => ({
      question: interaction.question,
      answer: interaction.answer,
    })),
    text: agentTrace.finalText || agentTrace.turns.map((turn) => turn.text).join(""),
    ...(agentTrace.retryEvents === undefined ? {} : { retryEvents: agentTrace.retryEvents }),
    ...(agentTrace.terminalOutcome === undefined
      ? {}
      : { terminalOutcome: agentTrace.terminalOutcome }),
    customEntries: agentTrace.customEntries,
  };
}

function normalizePrompts(options: RunOpenCandleSessionOptions): string[] {
  if (options.prompts !== undefined) {
    if (options.prompts.length === 0) {
      throw new Error("runOpenCandleSession requires at least one prompt");
    }
    return options.prompts;
  }
  if (options.prompt !== undefined) return [options.prompt];
  throw new Error("runOpenCandleSession requires prompt or prompts");
}

function createScriptedAskHandler(
  scriptedAnswers: string[],
  traceCollector: Pick<TraceCollector, "addInteraction">,
): AskUserHandler {
  let scriptedIndex = 0;
  return async (params) => {
    const answer = scriptedIndex < scriptedAnswers.length ? scriptedAnswers[scriptedIndex++] : null;
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
  options: { resolveSettleGraceMs: () => number; timeoutMs: number },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let promptFinished = false;
    let closed = false;
    let unsub = () => {};
    const timeoutTimer = setTimeout(() => {
      cleanup();
      reject(new Error(`OpenCandle harness timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    const cleanup = () => {
      closed = true;
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
      if (closed) return;
      cancelSettle();
      settleTimer = setTimeout(() => {
        // agent_end precedes Pi retry backoff and compaction. Only a fully
        // settled session can be captured or disposed by the harness.
        if (!promptFinished || session.isIdle === false) return;
        cleanup();
        resolve();
      }, options.resolveSettleGraceMs());
    };

    unsub = session.subscribe((event: AgentSessionEvent) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        cancelSettle();
      }
      if (
        event.type === "tool_execution_start" ||
        event.type === "auto_retry_start" ||
        event.type === "agent_start"
      ) {
        cancelSettle();
      }
      if ((event.type === "agent_end" && !event.willRetry) || event.type === "agent_settled") {
        finishAfterGrace();
      }
    });

    void session
      .prompt(prompt)
      .then(() => {
        promptFinished = true;
        finishAfterGrace();
      })
      .catch((error: unknown) => {
        cleanup();
        reject(error);
      });
  });
}

/**
 * A dispatched multi-step workflow keeps emitting steps after the first
 * `agent_end`, so it needs the longer settle grace. Read what the turn
 * actually dispatched from the session's own workflow entries rather than
 * guessing the workflow from the prompt text.
 */
function settleGraceMsForTurn(
  prompt: string,
  sessionManager: Pick<ReturnType<typeof PiSessionManager.inMemory>, "getEntries">,
): number {
  if (isAnalysisRequest(prompt).match) return 30_000;
  return dispatchedMultiStepWorkflow(sessionManager) ? 30_000 : 3_000;
}

function dispatchedMultiStepWorkflow(
  sessionManager: Pick<ReturnType<typeof PiSessionManager.inMemory>, "getEntries">,
): boolean {
  return drainOpenCandleCustomEntries(sessionManager).some((entry) => {
    if (entry.customType !== "opencandle-workflow" || !isRecord(entry.data)) return false;
    const workflow = entry.data.workflow;
    return typeof workflow === "string" && MULTI_STEP_WORKFLOWS.has(workflow as WorkflowType);
  });
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
  // Comprehensive analysis dispatches before the router runs, so a turn can
  // legitimately have no router entry. Read the workflow the turn actually
  // dispatched from its own `opencandle-workflow` entry rather than
  // re-deriving one from the prompt text.
  return classificationFromDispatchedWorkflow(agentTrace.customEntries ?? []);
}

function classificationFromDispatchedWorkflow(
  customEntries: readonly CustomEntryTrace[],
): ClassificationResult {
  const entry = [...customEntries]
    .reverse()
    .find((candidate) => candidate.customType === "opencandle-workflow");
  const data = isRecord(entry?.data) ? entry.data : null;
  const dispatched = typeof data?.workflow === "string" ? data.workflow : undefined;
  const resolvedSlots = isRecord(data?.resolvedSlots) ? data.resolvedSlots : null;
  const symbol = typeof resolvedSlots?.symbol === "string" ? resolvedSlots.symbol : undefined;
  const entities: ExtractedEntities = { symbols: symbol ? [symbol] : [] };

  // `comprehensive_analysis` is the multi-analyst deep dive on one symbol; it
  // is not a member of `WorkflowType`, and its routing-layer equivalent is
  // `single_asset_analysis`.
  if (dispatched === "comprehensive_analysis") {
    return { workflow: "single_asset_analysis", confidence: 1, tier: "rule", entities };
  }
  if (dispatched && DISPATCHABLE_WORKFLOW_LABELS.has(dispatched as WorkflowType)) {
    return { workflow: dispatched as WorkflowType, confidence: 1, tier: "rule", entities };
  }
  return { workflow: "unclassified", confidence: 0, tier: "rule", entities };
}

function routerTelemetryFromTrace(agentTrace: AgentTrace): EvalTrace["router"] {
  const customEntries = agentTrace.customEntries ?? [];
  const routerEntry = [...customEntries]
    .reverse()
    .find((entry) => entry.customType === "opencandle-router");
  const routeContextEntry = [...customEntries]
    .reverse()
    .find((entry) => entry.customType === "opencandle-route-context");
  const routerOutput = routerEntry ? getRouterOutputRecord(routerEntry.data) : null;
  const routeContext = isRecord(routeContextEntry?.data) ? routeContextEntry.data : null;
  const memoryQueryPlan = isRecord(routeContext?.memoryQueryPlan)
    ? routeContext.memoryQueryPlan
    : null;

  return {
    routeKind: stringOrUndefined(routeContext?.routeKind ?? routerOutput?.routeKind),
    workflow: stringOrUndefined(routeContext?.workflow ?? routerOutput?.workflow),
    missingRequired: stringArrayOrUndefined(
      routeContext?.missingRequired ?? routerOutput?.missing_required,
    ),
    toolBundles: stringArrayOrUndefined(routeContext?.toolBundles ?? routerOutput?.tool_bundles),
    activeToolNames: stringArrayOrUndefined(routeContext?.activeToolNames),
    memoryCategories: stringArrayOrUndefined(memoryQueryPlan?.categories),
    memoryProvenance: Array.isArray(routeContext?.memoryProvenance)
      ? routeContext.memoryProvenance
      : undefined,
    diagnostics: Array.isArray(routeContext?.diagnostics ?? routerOutput?.diagnostics)
      ? ((routeContext?.diagnostics ?? routerOutput?.diagnostics) as unknown[])
      : undefined,
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
    ? (stringArrayOrUndefined(routeContext.entities.symbols) ?? [])
    : [];
  const evidenceRecords = [
    ...plannedEvidenceRecords({
      prompt: agentTrace.prompt,
      evidencePlanId,
      policyCardId: stringOrUndefined(planning.policyCardId),
      symbols,
    }),
    ...toolCalls.map((toolCall, index) =>
      captureEvidenceFromToolCall(
        {
          name: toolCall.name,
          args: toolCall.args,
          result: toolCall.result,
          isError: toolCall.isError ?? false,
        },
        {
          traceId: "eval-trace",
          toolCallIndex: index,
        },
      ),
    ),
  ];

  const contract = answerContractId ? ANSWER_CONTRACT_REGISTRY[answerContractId] : undefined;
  const structuredTrace =
    contract && commitmentMode
      ? runStructuredChecks({
          contract,
          evidenceRecords,
          structuredCheckIds: structuredCheckArrayOrEmpty(planning.structuredCheckIds),
          answerText: finalText,
          finalAnswerMetadata: {
            commitmentMode,
            finalFields: inferFinalAnswerFieldsForEval(finalText, taskFamily),
            freshness: inferFreshnessForEval(finalText),
            sourceCoverage: inferSourceCoverageForEval(finalText, evidenceRecords, taskFamily),
            disclosedProviderStatuses: inferDisclosedProviderStatusesForEval(
              finalText,
              evidenceRecords,
            ),
            disclosedCapabilityGapIds: inferDisclosedCapabilityGapIdsForEval(
              finalText,
              capabilityGapIds,
              evidenceRecords,
            ),
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

function inferFinalAnswerFieldsForEval(text: string, taskFamily?: string): FinalAnswerField[] {
  const lower = text.toLowerCase();
  const fields: FinalAnswerField[] = [];
  const portfolioReviewShape =
    taskFamily === "portfolio_review" &&
    hasPortfolioReviewSubstantiveAssessment(lower) &&
    hasPortfolioReviewDownside(lower);
  if (
    /\b(bottom line|framework|checklist|workflow|how it works|mental model|main risks?|steps?)\b/.test(
      lower,
    ) ||
    (portfolioReviewShape && hasPortfolioReviewSections(lower))
  ) {
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
  if (portfolioReviewShape) {
    fields.push("clear_commitment");
  }
  if (
    /\b(unavailable|missing|cannot verify|not available|no live|unknown)\b/.test(lower) ||
    disclosesObservedDataGap(lower)
  ) {
    fields.push("data_gap_disclosure");
  }
  if (
    /\b(not verified|not verify|unverified|exact .* not|requires? .* provider|requires? .* source)\b/.test(
      lower,
    )
  ) {
    fields.push("data_gap_disclosure");
  }
  if (inferFreshnessForEval(text) !== undefined) {
    fields.push("freshness_disclosure");
  }
  if (/\b(source|coverage|filing|news|reddit|twitter|x\/twitter)\b/.test(lower)) {
    fields.push("source_coverage");
  }
  if (
    /\b(?:positive|negative|bullish|bearish|mixed)\s+(?:drivers?|factors?|signals?|evidence|rationale)\b|\b(?:sentiment|source)\s+(?:drivers?|rationale|evidence)\b|\bdrivers?:/.test(
      lower,
    )
  ) {
    fields.push("sentiment_rationale");
  }
  if (
    /\b(confidence|conviction|caveat|caveats|sample size|low sample|mixed|uncertain)\b/.test(lower)
  ) {
    fields.push("confidence_or_caveats");
  }
  if (
    /\b(based on your|stated percentages?|stated allocation|user[- ]stated|provided allocation)\b/.test(
      lower,
    )
  ) {
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

/**
 * Heuristic eval metadata for observed freshness only. It records a fact that
 * is literally present in the final answer (an as-of ISO date, explicit
 * market-closed wording, or a last-trading-day date) and never uses the wall
 * clock or invents a timestamp. Expiry dates, generic "freshness" words, bare
 * "last trading day" headings/phrases, and empty headings do not qualify. The
 * field and object are derived from this same function so they always agree.
 * This is not native production metadata.
 */
function inferFreshnessForEval(
  text: string,
): { asOfDate?: string; marketStatus?: string; lastTradingDay?: string } | undefined {
  const freshness: { asOfDate?: string; marketStatus?: string; lastTradingDay?: string } = {};
  const asOf = /\bas of\s+(\d{4}-\d{2}-\d{2})(?:T[0-9:.+-]+Z?)?/i.exec(text);
  if (asOf?.[1]) {
    freshness.asOfDate = asOf[1];
  }
  if (
    /\bmarket[- ]closed\b/i.test(text) ||
    /\bmarkets?\s+(?:is|are|was|were|has been|have been)\s+closed\b/i.test(text)
  ) {
    freshness.marketStatus = "closed";
  }
  const lastTradingDay = /\blast trading day\b\s*[:(]?\s*(\d{4}-\d{2}-\d{2})/i.exec(text);
  if (lastTradingDay?.[1]) {
    freshness.lastTradingDay = lastTradingDay[1];
  }
  return Object.keys(freshness).length > 0 ? freshness : undefined;
}

/**
 * Heuristic review-shape read for `portfolio_review` only. It looks for a
 * substantive evaluation sentence about the portfolio/allocation/sleeve plus
 * downside context. This is deliberately a text heuristic, not a semantic
 * parser: it does not establish that a trade recommendation was made, and it
 * never runs for other task families. Headings and bare keyword fragments do
 * not count as an evaluation sentence.
 */
function hasPortfolioReviewSubstantiveAssessment(lower: string): boolean {
  const sentences = lower
    .split(/\n+/)
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.replace(/[*_#]/g, " ").replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length > 0);
  return sentences.some((sentence) => {
    const wordCount = sentence.split(" ").filter(Boolean).length;
    if (wordCount < 8) return false;
    const subject =
      /\b(?:portfolio|allocation|allocat\w*|sleeve|asset mix|equity|equities|fixed[- ]income|bonds?|stocks?)\b/.test(
        sentence,
      );
    const judgment =
      /\b(?:faces?|facing|offers?|contends?|expected|likely|tested|challenging|rewarding|attractive|compelling|defensible|reasonable|effective|diversif\w*|pressure[sd]?|headwinds?|favou?rs?|prefers?|remains?|positioned|depends?|provides?|carries)\b/.test(
        sentence,
      );
    return subject && judgment;
  });
}

function hasPortfolioReviewDownside(lower: string): boolean {
  return /\b(?:risk|risks|downside|downsides|headwinds?|drawdown|volatility|loss|pressured?|slowdown|challenging|uncertain|tested)\b/.test(
    lower,
  );
}

function hasPortfolioReviewSections(lower: string): boolean {
  return /\b(?:implications?|risks?|downsides?|opportunit(?:y|ies)|watchlist|invalidation|assessment|conclusion|outlook)\b/.test(
    lower,
  );
}

/**
 * Matches singular/plural "data gap" mentions only when the answer is not
 * claiming there are none. A positive "no data gaps" statement must not be
 * recorded as a disclosure of observed provider failures.
 */
function disclosesObservedDataGap(lower: string): boolean {
  for (const match of lower.matchAll(/\bdata gaps?\b/g)) {
    const before = lower.slice(Math.max(0, (match.index ?? 0) - 48), match.index ?? 0);
    const negated = /\b(?:no|without|zero|free of|lacks?|lacking|lacked)\s+[a-z0-9%.\s-]*$/i.test(
      before,
    );
    if (!negated) return true;
  }
  return false;
}

function inferSourceCoverageForEval(
  text: string,
  evidenceRecords: PlanningEvidenceRecord[],
  taskFamily?: string,
): { sources: string[] } | undefined {
  const fields = inferFinalAnswerFieldsForEval(text, taskFamily);
  if (!fields.includes("source_coverage")) return undefined;
  const sources = evidenceRecords.map(
    (record) => record.source.toolName ?? record.source.provider ?? record.evidenceType,
  );
  return { sources: [...new Set(sources.length > 0 ? sources : ["final_answer"])] };
}

function inferDisclosedProviderStatusesForEval(
  text: string,
  evidenceRecords: PlanningEvidenceRecord[],
): string[] | undefined {
  if (
    !/\b(unavailable|missing|skipped|credentials?|required|no live|cannot verify|not available|not verified|unverified)\b/i.test(
      text,
    )
  ) {
    return undefined;
  }
  const statuses = evidenceRecords
    .filter((record) => record.providerStatus !== "available")
    .map((record) => record.providerStatus);
  return statuses.length > 0 ? [...new Set(statuses)] : undefined;
}

function inferDisclosedCapabilityGapIdsForEval(
  text: string,
  capabilityGapIds: CapabilityGapId[],
  evidenceRecords: PlanningEvidenceRecord[],
): CapabilityGapId[] | undefined {
  const required = new Set<CapabilityGapId>(capabilityGapIds);
  for (const record of evidenceRecords) {
    for (const gap of record.gaps) {
      if (gap.capabilityGapId) required.add(gap.capabilityGapId);
    }
  }
  const lower = text.toLowerCase();
  const disclosed = [...required].filter((gapId) => {
    if (gapId === "etf_holdings_overlap") {
      return /\b(?:exact .*holdings?|holdings? overlap|etf overlap|index overlap|constituent|not verified|not available)\b/.test(
        lower,
      );
    }
    if (gapId === "market_calendar") {
      return /\b(?:market calendar|holiday|last trading day|market status|after close|weekend)\b/.test(
        lower,
      );
    }
    if (gapId === "forward_rate_probabilities") {
      return /\b(?:forward rate|rate probabilities|fed probabilities|market-implied|probabilities unavailable)\b/.test(
        lower,
      );
    }
    if (gapId === "sentiment_sample_depth") {
      return /\b(?:sample depth|sample size|sentiment coverage|low volume|source coverage)\b/.test(
        lower,
      );
    }
    if (gapId === "earnings_event_risk") {
      return /\b(?:earnings event|event risk|implied move|earnings timing|not verified)\b/.test(
        lower,
      );
    }
    return lower.includes(gapId.replaceAll("_", " "));
  });
  return disclosed.length > 0 ? disclosed : undefined;
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
  policyCardId?: string;
  symbols: string[];
}) {
  if (options.evidencePlanId === "market_status") {
    return [
      buildMarketStatusEvidence({
        text: options.prompt,
        traceId: "eval-trace",
      }),
    ];
  }
  if (options.evidencePlanId === "ticker_disambiguation") {
    return [
      buildTickerDisambiguationEvidence({
        text: options.prompt,
        symbols: options.symbols,
        traceId: "eval-trace",
      }),
    ];
  }
  if (
    options.policyCardId === "portfolio_rebalance_review" &&
    /\d+(?:\.\d+)?\s*%/.test(options.prompt)
  ) {
    return [
      buildPortfolioExposureMapEvidence({
        text: options.prompt,
        traceId: "eval-trace",
      }),
    ];
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
  const workflow =
    typeof output.workflow === "string" && isWorkflowType(output.workflow)
      ? output.workflow
      : undefined;
  const entities = isRecord(output.entities)
    ? ({
        ...output.entities,
        symbols: Array.isArray(output.entities.symbols)
          ? output.entities.symbols.filter((symbol): symbol is string => typeof symbol === "string")
          : [],
      } as ExtractedEntities)
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
  return (
    value === "single_asset_analysis" ||
    value === "portfolio_builder" ||
    value === "options_screener" ||
    value === "compare_assets" ||
    value === "watchlist_or_tracking" ||
    value === "general_finance_qa" ||
    value === "unclassified"
  );
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
    "assumption_disclosed",
    "tax_caveat_present",
    "target_bands_present",
    "when_not_ideal_present",
  ]);
  return (stringArrayOrUndefined(value) ?? []).filter((item): item is StructuredCheckId =>
    allowed.has(item as StructuredCheckId),
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
    allowed.has(item as CapabilityGapId),
  );
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
  return value in ANSWER_CONTRACT_REGISTRY ? (value as AnswerContractId) : undefined;
}
