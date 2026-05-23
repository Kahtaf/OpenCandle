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
import { classifyIntent } from "../../src/routing/classify-intent.js";
import type { ClassificationResult, ExtractedEntities, WorkflowType } from "../../src/routing/types.js";
import type { AskUserHandler } from "../../src/types/index.js";
import type { EvalTrace, TraceToolCall } from "../evals/types.js";
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
  return {
    prompt: agentTrace.prompt,
    classification: classificationFromTrace(agentTrace),
    router: routerTelemetryFromTrace(agentTrace),
    toolCalls: agentTrace.turns.flatMap((turn) =>
      turn.toolCalls.map(
        (tool): TraceToolCall => ({
          name: tool.name,
          args: tool.args,
          result: tool.result,
        }),
      ),
    ),
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
