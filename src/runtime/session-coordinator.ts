import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ModelRuntime,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { isAnalystSplit, parseAnalystOutput, parseDebateOutput } from "../analysts/contracts.js";
import { buildAnalystVoteTallyBlock } from "../analysts/orchestrator.js";
import type { FreshnessStamp } from "../infra/freshness.js";
import { MarketStateService } from "../market-state/service.js";
import {
  formatJsonSummary,
  formatLatestReportSummary,
  formatPortfolioSummary,
  formatWatchlistSummary,
} from "../market-state/summaries.js";
import { MemoryStorage } from "../memory/storage.js";

/**
 * Alias for the session-manager handle extensions receive via
 * `ExtensionContext`. `ReadonlySessionManager` is defined inside pi-coding-
 * agent but is not re-exported from the package's `.` entry, so we derive
 * the shape we need from the public `ExtensionContext` type.
 */
type ReadonlySessionManager = ExtensionContext["sessionManager"];

import type { FilteredMemoryEntry } from "../memory/manager.js";
import { MemoryManager } from "../memory/manager.js";
import { extractPreferences } from "../memory/preference-extractor.js";
import type { MemoryEntry } from "../memory/types.js";
import { type FallbackContext, PromptContextBuilder } from "../prompts/context-builder.js";
import type { SymbolValidationCache } from "../prompts/symbol-preflight.js";
import type { RouterRouteKind } from "../routing/router-types.js";
import type { ResolvedTurnContext } from "../routing/turn-context.js";
import type { EvidenceRecord } from "./evidence.js";
import { collectToolNumbers, extractNumericClaims } from "./numeric-claims.js";
import type { WorkflowDefinition } from "./prompt-step.js";
import {
  captureToolEvidence,
  extractAssistantText,
  promptStepOutput,
  toStepDefinitions,
} from "./prompt-step.js";
import { ProviderTracker } from "./provider-tracker.js";
import { clearRunContext, type RunContextToken, setRunContext } from "./run-context.js";
import type { StateDatabase } from "./state-database.js";
import { checkNumberMatch } from "./validation.js";
import { WorkflowEventLogger } from "./workflow-events.js";
import { WorkflowRunner } from "./workflow-runner.js";
import type { AnalystOutput, StepOutput, WorkflowRun } from "./workflow-types.js";

const PROMPT_SETTLE_POLL_MS = 25;
const IMMEDIATE_IDLE_GRACE_MS = 100;

interface ActiveWorkflowRunRef {
  active: boolean;
  contextToken: RunContextToken;
}

interface ActiveStepCapture {
  evidence: EvidenceRecord[];
  pendingTools: Map<string, { tool: string; args: unknown; startedAt: string }>;
  rawText: string;
}

export interface SessionCoordinatorOptions {
  /**
   * Runtime-owned durable state factory. Browser-hosted and test compositions
   * can intentionally return null while the WASM database is unavailable.
   */
  stateDatabaseFactory?: () => StateDatabase | null;
  setupRunner?: SessionSetupRunner;
  addonToolDescriptionsFactory?: () => ReadonlyArray<{
    name: string;
    description: string;
  }>;
  toolDefaultsFactory?: (
    database: StateDatabase | null,
  ) => ReadonlyMap<string, Record<string, unknown>>;
}

export type SessionSetupRunner = (
  pi: ExtensionAPI,
  ctx: ExtensionContext | ExtensionCommandContext,
  options: { mode: "startup" | "manual" },
  modelRuntime?: ModelRuntime,
) => Promise<"ready" | "shutdown" | "cancelled">;

function parseMaybeJson(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

type QueueContext =
  | ExtensionCommandContext
  | {
      isIdle(): boolean;
      hasPendingMessages?(): boolean;
      ui?: { notify(message: string, level?: string): void };
      sessionManager?: {
        getEntries?(): SessionEntry[];
        getBranch?(): SessionEntry[];
      };
    };

function hasPendingMessages(ctx: QueueContext): boolean {
  return ctx.hasPendingMessages?.() ?? false;
}

function isReadyForNextPrompt(ctx: QueueContext): boolean {
  return ctx.isIdle() && !hasPendingMessages(ctx);
}

function readSessionEntries(ctx: QueueContext): SessionEntry[] {
  const manager = "sessionManager" in ctx ? ctx.sessionManager : undefined;
  const entries = manager?.getEntries?.() ?? manager?.getBranch?.();
  return Array.isArray(entries) ? entries : [];
}

function canObserveSessionEntries(ctx: QueueContext): boolean {
  const manager = "sessionManager" in ctx ? ctx.sessionManager : undefined;
  return typeof manager?.getEntries === "function" || typeof manager?.getBranch === "function";
}

function messageContentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as { type?: unknown; text?: unknown };
      return record.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .join("")
    .trim();
}

function terminalAssistantOutcomeAfterPrompt(
  ctx: QueueContext,
  entryCount: number,
  expectedPrompt?: string,
): "success" | "failure" | undefined {
  const entries = readSessionEntries(ctx);
  const promptIndex = entries.findIndex((entry, index) => {
    if (index < entryCount || entry.type !== "message") return false;
    const message = entry.message as { role?: unknown; content?: unknown };
    if (message.role !== "user") return false;
    return (
      expectedPrompt === undefined || messageContentText(message.content) === expectedPrompt.trim()
    );
  });
  if (promptIndex < 0) return undefined;

  for (let index = promptIndex + 1; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry?.type !== "message") continue;
    const message = entry.message as { role?: unknown; stopReason?: unknown };
    if (message.role === "user") return undefined;
    if (message.role !== "assistant") continue;
    if (message.stopReason === "stop" || message.stopReason === "length") return "success";
    if (message.stopReason === "error" || message.stopReason === "aborted") return "failure";
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPromptSettlement(
  ctx: QueueContext,
  isCurrentRun: () => boolean,
  options: {
    entriesBeforePrompt?: number;
    expectedPrompt?: string;
    requireActivity?: boolean;
  } = {},
): Promise<boolean> {
  let sawBusyOrPending = !isReadyForNextPrompt(ctx);
  // Browser-hosted composition exposes getEntries(), while Pi's canonical
  // extension context exposes its read-only getBranch() view. If neither is
  // available, retain the queue-only fallback rather than deadlocking an
  // extension host that cannot provide transcript observation at all.
  const requiresObservableActivity = options.requireActivity && canObserveSessionEntries(ctx);
  const startedAt = Date.now();

  while (isCurrentRun()) {
    const ready = isReadyForNextPrompt(ctx);
    const terminalOutcome =
      options.entriesBeforePrompt !== undefined &&
      !hasPendingMessages(ctx) &&
      terminalAssistantOutcomeAfterPrompt(ctx, options.entriesBeforePrompt, options.expectedPrompt);
    if (terminalOutcome === "failure") {
      throw new Error("workflow_prompt_failed");
    }
    if (!ready) {
      sawBusyOrPending = true;
    }

    if ((sawBusyOrPending && ready) || terminalOutcome === "success") {
      return true;
    }

    if (
      !requiresObservableActivity &&
      !sawBusyOrPending &&
      ready &&
      Date.now() - startedAt >= IMMEDIATE_IDLE_GRACE_MS
    ) {
      return true;
    }

    await sleep(PROMPT_SETTLE_POLL_MS);
  }

  return false;
}

/**
 * Coordinates session lifecycle, memory, workflow execution,
 * and prompt assembly. The extension delegates to this.
 */
export class SessionCoordinator {
  private db: StateDatabase | null = null;
  private storage: MemoryStorage | null = null;
  private memoryManager: MemoryManager | null = null;
  private eventLogger: WorkflowEventLogger | null = null;
  private runner: WorkflowRunner;
  private providerTracker: ProviderTracker;
  private activeWorkflowRunRef: ActiveWorkflowRunRef | null = null;
  private activeWorkflowPromise: Promise<void> | null = null;
  private activeWorkflowType: string | undefined;
  private activeStepCapture: ActiveStepCapture | null = null;
  private workflowEventCaptureInstalled = false;
  private tickerValidationCache: SymbolValidationCache = new Map();
  private sessionId = "unknown";

  constructor(private readonly options: SessionCoordinatorOptions = {}) {
    // Runner is always available — event logger is optional and added after session init
    this.providerTracker = new ProviderTracker();
    this.runner = new WorkflowRunner({ providerTracker: this.providerTracker });
  }

  getStorage(): MemoryStorage | null {
    return this.storage;
  }

  getRunner(): WorkflowRunner {
    return this.runner;
  }

  getTickerValidationCache(): SymbolValidationCache {
    return this.tickerValidationCache;
  }

  clearTickerValidationCache(): void {
    this.tickerValidationCache.clear();
  }

  /** Initialize session: database, memory, event logger, workflow runner. */
  initSession(sessionId: string): void {
    this.db = this.options.stateDatabaseFactory?.() ?? null;
    this.storage = this.db ? new MemoryStorage(this.db) : null;
    this.memoryManager = this.storage ? new MemoryManager(this.storage) : null;
    this.eventLogger = this.db ? new WorkflowEventLogger(this.db) : null;
    this.providerTracker = new ProviderTracker();
    this.runner = new WorkflowRunner({
      eventLogger: this.eventLogger ?? undefined,
      providerTracker: this.providerTracker,
    });
    this.sessionId = sessionId;
  }

  /** Run setup flow. */
  async runSetup(
    pi: ExtensionAPI,
    ctx: ExtensionContext | ExtensionCommandContext,
    options: { mode: "startup" | "manual" },
    modelRuntime?: ModelRuntime,
  ): Promise<"ready" | "shutdown" | "cancelled"> {
    return this.options.setupRunner?.(pi, ctx, options, modelRuntime) ?? "ready";
  }

  /** Extract and persist user preferences from natural language. */
  extractAndStorePreferences(text: string): void {
    if (!this.storage) return;
    for (const pref of extractPreferences(text)) {
      this.storage.upsertPreference({
        key: pref.key,
        valueJson: JSON.stringify(pref.value),
        confidence: pref.confidence,
        source: "inferred",
      });
    }
  }

  /** Record a workflow run in storage. */
  recordWorkflowRun(
    workflowType: string,
    entities: object,
    resolved: object,
    defaultsUsed: unknown[],
    turnType = "workflow",
  ): void {
    this.storage?.insertWorkflowRun({
      sessionId: this.sessionId,
      workflowType,
      inputSlotsJson: JSON.stringify(entities),
      resolvedSlotsJson: JSON.stringify(resolved),
      defaultsUsedJson: JSON.stringify(defaultsUsed),
      turnType,
    });
  }

  /**
   * Extract the last `max` user/assistant turns from the session branch as
   * `{role, text}` pairs, oldest→newest. Walks `sessionManager.getBranch()`
   * (root→leaf order) and filters per the intent-routing spec:
   *
   * - Keep only `type === "message"` entries whose `message.role` is
   *   `"user"` or `"assistant"`. Compaction, branch_summary, custom, label,
   *   thinking_level_change, model_change, and session_info entries are
   *   skipped. Tool-result messages (`role === "toolResult"`) are skipped.
   * - Extract concatenated text-block content. User `content` may be a
   *   plain string; assistant `content` is always an array of blocks, from
   *   which only `type === "text"` blocks contribute.
   * - Drop entries whose resulting text is empty or whitespace-only
   *   (handles aborted assistant turns and tool-only assistant turns).
   * - Slice to the last `max` qualifying entries.
   *
   * Privacy note: conversational text in priorTurns is NOT filtered by
   * `NEVER_TRUST_FROM_MEMORY` (which governs structured memory keys). A
   * future `/forget` command is the designated scrubbing primitive — see
   * `openspec/changes/router-context-and-observability/` for the follow-up.
   */
  buildPriorTurns(
    sessionManager: ReadonlySessionManager,
    max = 5,
  ): Array<{ role: "user" | "assistant"; text: string }> {
    const branch = sessionManager.getBranch();
    const turns: Array<{ role: "user" | "assistant"; text: string }> = [];

    for (const entry of branch) {
      if (entry.type !== "message") continue;
      const msg = (entry as SessionEntry & { type: "message" }).message;
      if (!msg || typeof msg !== "object") continue;
      const role = (msg as { role?: unknown }).role;
      if (role !== "user" && role !== "assistant") continue;

      const rawContent = (msg as { content?: unknown }).content;
      let text = "";
      if (typeof rawContent === "string") {
        text = rawContent;
      } else if (Array.isArray(rawContent)) {
        for (const block of rawContent) {
          if (
            block &&
            typeof block === "object" &&
            (block as { type?: unknown }).type === "text" &&
            typeof (block as { text?: unknown }).text === "string"
          ) {
            text += (block as { text: string }).text;
          }
        }
      }

      if (text.trim().length === 0) continue;
      turns.push({ role, text });
    }

    return turns.slice(-max);
  }

  /**
   * Expose prior turns + recent runs + profile snapshot for the router
   * input context. Fixed-window per design.md §7 (last 5 turns, 3 runs).
   * `priorTurns` is derived from the session branch at call time; see
   * `buildPriorTurns` for the filter rules.
   */
  buildRouterContextBase(sessionManager: ReadonlySessionManager): {
    profileSnapshot: Record<string, unknown>;
    recentWorkflowRuns: Array<{
      workflowType: string;
      turnType: string;
      resolvedSlots?: Record<string, unknown>;
      createdAt: string;
    }>;
    priorTurns: Array<{ role: "user" | "assistant"; text: string }>;
  } {
    const priorTurns = this.buildPriorTurns(sessionManager);
    if (!this.storage) {
      return { profileSnapshot: {}, recentWorkflowRuns: [], priorTurns };
    }
    const prefs = this.storage.getPreferencesByNamespace("global");
    const profileSnapshot: Record<string, unknown> = {};
    for (const p of prefs) {
      const key = String(p.key);
      const rawValue = p.value_json;
      if (typeof rawValue === "string") {
        try {
          profileSnapshot[key] = JSON.parse(rawValue);
        } catch {
          profileSnapshot[key] = rawValue;
        }
      }
    }
    const runs = this.storage.getRecentWorkflowRuns(3).map((r) => ({
      workflowType: String(r.workflow_type ?? ""),
      turnType: String(r.turn_type ?? "workflow"),
      resolvedSlots: parseMaybeJson(r.resolved_slots_json),
      createdAt: String(r.created_at ?? ""),
    }));
    return { profileSnapshot, recentWorkflowRuns: runs, priorTurns };
  }

  retrieveMemoryForRoute(
    routeKind: RouterRouteKind,
    workflowType?: string,
    overriddenSlots?: string[],
  ): { entries: MemoryEntry[]; filtered: FilteredMemoryEntry[] } {
    if (!this.memoryManager) return { entries: [], filtered: [] };
    return this.memoryManager.retrieveDetailed(workflowType ?? routeKind, overriddenSlots);
  }

  /** Build system prompt using composable sections. */
  buildSystemPrompt(
    basePrompt: string,
    workflowType?: string,
    fallbackContext?: FallbackContext,
    resolvedTurnContext?: ResolvedTurnContext,
  ): string {
    const builder = new PromptContextBuilder();

    const addonTools = this.options.addonToolDescriptionsFactory?.() ?? [];
    const addonDescriptions =
      addonTools.length > 0 ? addonTools.map((t) => `${t.name}: ${t.description}`) : undefined;

    const memoryContext = this.memoryManager
      ? this.memoryManager.buildContext(
          resolvedTurnContext?.workflow ??
            workflowType ??
            resolvedTurnContext?.routeKind ??
            "unclassified",
        )
      : undefined;
    const savedMarketStateContext =
      this.db &&
      shouldIncludeSavedMarketStateContext(workflowType, resolvedTurnContext, fallbackContext)
        ? buildSavedMarketStateContext(this.db)
        : "";
    const combinedMemoryContext = [savedMarketStateContext, memoryContext]
      .filter((part) => part && part.trim().length > 0)
      .join("\n\n");

    builder.populateFromOptions({
      workflowType,
      memoryContext: combinedMemoryContext || undefined,
      addonToolDescriptions: addonDescriptions,
      fallbackContext,
      resolvedTurnContext,
    });

    let toolDefaults: string[] = [];
    try {
      toolDefaults = formatToolDefaultsForPrompt(
        this.options.toolDefaultsFactory?.(this.db) ?? new Map(),
      );
    } catch {
      toolDefaults = [];
    }
    const defaultsSection =
      toolDefaults.length > 0 ? `\n\n## User Tool Defaults\n${toolDefaults.join("\n")}` : "";

    return `${basePrompt}\n\n${builder.build()}${defaultsSection}`;
  }

  /**
   * Stash a pending fallback context so the very next `before_agent_start`
   * hook can slot it into the system prompt. Cleared after consumption so
   * subsequent turns do not inherit stale fallback directives.
   */
  private pendingFallbackContext: FallbackContext | null = null;
  private pendingResolvedTurnContext: ResolvedTurnContext | null = null;

  setPendingFallbackContext(ctx: FallbackContext | null): void {
    this.pendingFallbackContext = ctx;
  }

  setPendingResolvedTurnContext(ctx: ResolvedTurnContext | null): void {
    this.pendingResolvedTurnContext = ctx;
  }

  consumePendingFallbackContext(): FallbackContext | null {
    const ctx = this.pendingFallbackContext;
    this.pendingFallbackContext = null;
    return ctx;
  }

  consumePendingResolvedTurnContext(): ResolvedTurnContext | null {
    const ctx = this.pendingResolvedTurnContext;
    this.pendingResolvedTurnContext = null;
    return ctx;
  }

  /**
   * Execute a workflow definition through the WorkflowRunner,
   * sending prompts via Pi with settlement-based sequencing.
   */
  executeWorkflow(pi: ExtensionAPI, definition: WorkflowDefinition, ctx: QueueContext): void {
    this.startWorkflowRun(pi, definition, ctx, "send");
  }

  /**
   * Start workflow tracking for an input handler that will return a Pi
   * transform result. The current prompt becomes the first workflow prompt;
   * only later steps are sent through Pi.
   */
  /** Workflow type of the in-flight run, for prompt context on workflow turns. */
  getActiveWorkflowType(): string | undefined {
    return this.activeWorkflowRunRef?.active ? this.activeWorkflowType : undefined;
  }

  /** Wait until the current workflow, including every queued Pi prompt, is terminal. */
  async waitForActiveWorkflow(): Promise<void> {
    while (this.activeWorkflowPromise) {
      const pending = this.activeWorkflowPromise;
      await pending;
      if (this.activeWorkflowPromise === pending) return;
    }
  }

  transformWorkflowInput(
    pi: ExtensionAPI,
    definition: WorkflowDefinition,
    ctx: QueueContext,
  ): string | undefined {
    if (definition.steps.length === 0) return undefined;
    this.startWorkflowRun(pi, definition, ctx, "transform");
    return definition.steps[0].prompt;
  }

  private startWorkflowRun(
    pi: ExtensionAPI,
    definition: WorkflowDefinition,
    ctx: QueueContext,
    firstPromptMode: "send" | "transform",
  ): void {
    if (definition.steps.length === 0) return;
    this.installWorkflowEventCapture(pi);

    const runner = this.runner;
    if (this.activeWorkflowRunRef) {
      this.activeWorkflowRunRef.active = false;
    }
    runner.cancel();
    this.activeWorkflowType = definition.workflowType;

    const [firstStep] = definition.steps;
    let entriesBeforeActivePrompt = readSessionEntries(ctx).length;
    let activePrompt = firstPromptMode === "send" ? firstStep.prompt : undefined;

    if (firstPromptMode === "send") {
      const startedBusy = !isReadyForNextPrompt(ctx);
      if (startedBusy) {
        pi.sendUserMessage(firstStep.prompt, { deliverAs: "followUp" });
        ctx.ui?.notify?.("Analysis queued as follow-up.", "info");
      } else {
        pi.sendUserMessage(firstStep.prompt);
      }
    }

    // Make the run's ProviderTracker accessible to tools during execution
    const contextToken = setRunContext({ providerTracker: this.providerTracker });
    const runRef: ActiveWorkflowRunRef = { active: true, contextToken };
    this.activeWorkflowRunRef = runRef;

    // Start the runner in the background for state tracking
    const stepDefs = toStepDefinitions(definition.steps);
    const workflowPromise = runner
      .start(
        definition.workflowType,
        stepDefs,
        async (step, stepIndex, _priorEvidence, context) => {
          let entriesBeforeStep = entriesBeforeActivePrompt;
          const eventCapture = this.startStepCapture();

          // First step was already sent above — later steps are sent here.
          if (stepIndex > 0) {
            const settled = await waitForPromptSettlement(ctx, () => runRef.active, {
              entriesBeforePrompt: entriesBeforeActivePrompt,
              expectedPrompt: activePrompt,
            });
            if (!settled || !runRef.active) {
              throw new Error("run_cancelled");
            }
            if (shouldSkipRebuttal(runner.getActiveRun(), step.stepType)) {
              this.appendWorkflowEvent(pi, "step_skipped", {
                stepType: step.stepType,
                reason: "analyst_consensus",
              });
              throw new Error("analyst_consensus");
            }
            entriesBeforeStep = readSessionEntries(ctx).length;
            entriesBeforeActivePrompt = entriesBeforeStep;
            const prompt = this.prepareWorkflowPrompt(
              pi,
              definition.steps[stepIndex].prompt,
              step.stepType,
              runner.getActiveRun(),
            );
            activePrompt = prompt;
            pi.sendUserMessage(prompt);
          }

          const settled = await waitForPromptSettlement(ctx, () => runRef.active, {
            entriesBeforePrompt: entriesBeforeStep,
            expectedPrompt: activePrompt,
            // Pi accepts follow-up messages asynchronously. Do not interpret a
            // briefly idle queue as a completed workflow step before that
            // prompt is actually observed; doing so queues every remaining
            // workflow instruction without any assistant/tool events between
            // them.
            requireActivity: true,
          });
          if (!settled || !runRef.active) {
            throw new Error("run_cancelled");
          }

          let stepEntries = readSessionEntries(ctx).slice(entriesBeforeStep);
          let rawText = capturedText(eventCapture, stepEntries);
          let output = promptStepOutput(stepIndex, step.stepType, {
            evidence: capturedEvidence(eventCapture, stepEntries),
            rawText,
          });

          if (
            isStructuredAnalystStep(step.stepType) &&
            !hasStructuredContract(step.stepType, rawText)
          ) {
            const entriesBeforeRetry = readSessionEntries(ctx).length;
            entriesBeforeActivePrompt = entriesBeforeRetry;
            const retryPrompt =
              "Please revise your previous response to include the exact required final output format from the stage prompt. Do not add new tool calls.";
            activePrompt = retryPrompt;
            pi.sendUserMessage(retryPrompt);
            const retrySettled = await waitForPromptSettlement(ctx, () => runRef.active, {
              entriesBeforePrompt: entriesBeforeRetry,
              expectedPrompt: retryPrompt,
              requireActivity: true,
            });
            if (!retrySettled || !runRef.active) {
              throw new Error("run_cancelled");
            }
            stepEntries = readSessionEntries(ctx).slice(entriesBeforeStep);
            rawText = capturedText(eventCapture, stepEntries);
            output = promptStepOutput(stepIndex, step.stepType, {
              evidence: capturedEvidence(eventCapture, stepEntries),
              rawText,
            });
          }

          const outputValidation = definition.steps[stepIndex].outputValidation;
          let validationErrors = outputValidation?.validate(rawText) ?? [];
          if (outputValidation && validationErrors.length > 0) {
            this.appendWorkflowEvent(pi, "output_validation_failed", {
              stepType: step.stepType,
              errors: validationErrors,
            });
            const entriesBeforeRepair = readSessionEntries(ctx).length;
            entriesBeforeActivePrompt = entriesBeforeRepair;
            eventCapture.rawText = "";
            const repairPrompt = outputValidation.repairPrompt(validationErrors);
            activePrompt = repairPrompt;
            pi.sendUserMessage(repairPrompt);
            const repairSettled = await waitForPromptSettlement(ctx, () => runRef.active, {
              entriesBeforePrompt: entriesBeforeRepair,
              expectedPrompt: repairPrompt,
              requireActivity: true,
            });
            if (!repairSettled || !runRef.active) {
              throw new Error("run_cancelled");
            }
            stepEntries = readSessionEntries(ctx).slice(entriesBeforeRepair);
            rawText = capturedText(eventCapture, stepEntries);
            output = promptStepOutput(stepIndex, step.stepType, {
              evidence: capturedEvidence(eventCapture, stepEntries),
              rawText,
            });
            validationErrors = outputValidation.validate(rawText);
            if (validationErrors.length > 0) {
              this.appendWorkflowEvent(pi, "output_validation_failed", {
                stepType: step.stepType,
                errors: validationErrors,
                repairAttempted: true,
              });
              throw new Error(`workflow_output_validation_failed: ${validationErrors.join("; ")}`);
            }
            this.appendWorkflowEvent(pi, "output_validation_passed", {
              stepType: step.stepType,
              repairAttempted: true,
            });
          }

          for (const record of output.evidence) {
            const value = isPlainObject(record.value) ? record.value : {};
            this.eventLogger?.log(context.runId, stepIndex, "tool_called", {
              stepType: step.stepType,
              tool: value.tool,
              args: value.args,
              resultDigest: value.resultDigest,
            });
          }

          if (this.activeStepCapture === eventCapture) {
            this.activeStepCapture = null;
          }

          const structuredOutput = attachStructuredOutput(pi, output);
          if (step.stepType === "synthesis") {
            this.emitSynthesisValidation(
              pi,
              context.runId,
              stepIndex,
              runner.getActiveRun(),
              structuredOutput,
            );
          }

          return structuredOutput;
        },
      )
      .then((completedRun) => {
        // Validation is only emitted by synthesis. Persist a neutral terminal
        // marker for every completed or failed workflow so transcript
        // consumers can end the workflow group before an ordinary later turn.
        if (
          this.activeWorkflowRunRef === runRef &&
          (completedRun.status === "completed" || completedRun.status === "failed")
        ) {
          // A long workflow can finish after Pi replaces the session context
          // (for example, when the GUI opens a new session). The terminal
          // marker belongs to the old session, so do not let a stale-context
          // assertion tear down the whole local runtime while cleaning up.
          try {
            pi.appendEntry("opencandle-workflow-complete", {
              workflow: completedRun.workflowType,
              status: completedRun.status,
            });
          } catch (error) {
            if (!isStaleExtensionContextError(error)) throw error;
          }
        }
      })
      .finally(() => {
        if (this.activeWorkflowRunRef === runRef) {
          this.activeStepCapture = null;
        }
        clearRunContext(runRef.contextToken);
        if (this.activeWorkflowRunRef === runRef) {
          this.activeWorkflowRunRef = null;
        }
        if (this.activeWorkflowPromise === workflowPromise) {
          this.activeWorkflowPromise = null;
        }
      });
    this.activeWorkflowPromise = workflowPromise;
  }

  /** Cancel any active workflow. */
  cancelActiveWorkflow(): void {
    const activeRef = this.activeWorkflowRunRef;
    if (activeRef) {
      activeRef.active = false;
      clearRunContext(activeRef.contextToken);
      this.activeWorkflowRunRef = null;
    }
    this.activeStepCapture = null;
    this.runner?.cancel();
  }

  private startStepCapture(): ActiveStepCapture {
    const capture: ActiveStepCapture = {
      evidence: [],
      pendingTools: new Map(),
      rawText: "",
    };
    this.activeStepCapture = capture;
    return capture;
  }

  private installWorkflowEventCapture(pi: ExtensionAPI): void {
    const on = (pi as { on?: unknown }).on;
    if (this.workflowEventCaptureInstalled || typeof on !== "function") return;
    this.workflowEventCaptureInstalled = true;

    pi.on("message_update", (event) => {
      const capture = this.activeStepCapture;
      if (!capture || event.assistantMessageEvent.type !== "text_delta") return;
      capture.rawText += event.assistantMessageEvent.delta;
    });

    pi.on("tool_execution_start", (event) => {
      const capture = this.activeStepCapture;
      if (!capture) return;
      capture.pendingTools.set(event.toolCallId, {
        tool: event.toolName,
        args: event.args ?? {},
        startedAt: new Date().toISOString(),
      });
    });

    pi.on("tool_execution_end", (event) => {
      const capture = this.activeStepCapture;
      if (!capture) return;
      const completedAt = new Date().toISOString();
      const pending = capture.pendingTools.get(event.toolCallId);
      capture.pendingTools.delete(event.toolCallId);
      const tool = pending?.tool ?? event.toolName;
      if (!tool) return;
      capture.evidence.push(
        toolEvidenceRecord({
          tool,
          args: pending?.args ?? {},
          result: event.result,
          startedAt: pending?.startedAt ?? completedAt,
          completedAt,
          isError: event.isError === true,
        }),
      );
    });
  }

  private prepareWorkflowPrompt(
    pi: ExtensionAPI,
    prompt: string,
    stepType: string,
    run: WorkflowRun | null,
  ): string {
    if (stepType !== "synthesis") return prompt;
    const parsedAnalysts = collectParsedAnalystOutputs(run);
    const tallyBlock = buildAnalystVoteTallyBlock(parsedAnalysts);
    if (!tallyBlock) {
      this.eventLogger?.log(run?.runId ?? "unknown", run?.currentStepIndex ?? 0, "tally_skipped", {
        reason: "tally_skipped",
        parsedAnalystCount: parsedAnalysts.length,
      });
      this.appendWorkflowEvent(pi, "tally_skipped", {
        reason: "fewer_than_2_parsed_analysts",
        parsedAnalystCount: parsedAnalysts.length,
      });
      return prompt;
    }
    this.eventLogger?.log(run?.runId ?? "unknown", run?.currentStepIndex ?? 0, "tally_injected", {
      tallyBlock,
      parsedAnalystCount: parsedAnalysts.length,
    });
    this.appendWorkflowEvent(pi, "tally_injected", {
      tallyBlock,
      parsedAnalystCount: parsedAnalysts.length,
    });
    return `${tallyBlock}\n\n${prompt}`;
  }

  private emitSynthesisValidation(
    pi: ExtensionAPI,
    runId: string,
    stepIndex: number,
    run: WorkflowRun | null,
    currentOutput: StepOutput,
  ): void {
    const validationInput = collectValidationInput(run, currentOutput);
    const mismatches = checkNumberMatch(
      validationInput.evidence,
      validationInput.toolResults,
    ).filter((entry) => entry.type === "failure");
    const passed = mismatches.length === 0;
    const payload = {
      passed,
      mismatches,
      skipped_unparsed: validationInput.skippedUnparsed,
    };
    this.eventLogger?.log(runId, stepIndex, passed ? "validation_passed" : "validation_failed", {
      mismatches,
      skipped_unparsed: validationInput.skippedUnparsed,
    });
    pi.appendEntry("opencandle-validation", payload);
    this.appendWorkflowEvent(pi, passed ? "validation_passed" : "validation_failed", {
      mismatches,
      skipped_unparsed: validationInput.skippedUnparsed,
    });
  }

  private appendWorkflowEvent(
    pi: ExtensionAPI,
    eventType: string,
    payload: Record<string, unknown>,
  ): void {
    pi.appendEntry("opencandle-workflow-event", {
      eventType,
      ...payload,
    });
  }
}

function isStaleExtensionContextError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("extension ctx is stale");
}

function capturedText(capture: ActiveStepCapture, entries: SessionEntry[]): string {
  return capture.rawText.trim() || extractAssistantText(entries);
}

function capturedEvidence(capture: ActiveStepCapture, entries: SessionEntry[]): EvidenceRecord[] {
  return capture.evidence.length > 0 ? [...capture.evidence] : captureToolEvidence(entries);
}

function collectParsedAnalystOutputs(run: WorkflowRun | null): AnalystOutput[] {
  if (!run) return [];
  const outputs: AnalystOutput[] = [];
  for (const output of run.stepOutputs.values()) {
    if (output.parsed === true && output.analystOutput) {
      outputs.push(output.analystOutput);
    }
  }
  return outputs;
}

function shouldSkipRebuttal(run: WorkflowRun | null, stepType: string): boolean {
  if (stepType !== "debate_rebuttal") return false;
  const parsedAnalysts = collectParsedAnalystOutputs(run);
  // Degradation rule: with fewer than two parsed analyst outputs there is no
  // trustworthy consensus signal to gate on — run the rebuttal exactly as the
  // status quo instead of skipping because isAnalystSplit([]) is false.
  if (parsedAnalysts.length < 2) return false;
  return !isAnalystSplit(parsedAnalysts);
}

function collectValidationInput(
  run: WorkflowRun | null,
  currentOutput?: StepOutput,
): {
  evidence: EvidenceRecord[];
  toolResults: Map<string, number>;
  skippedUnparsed: string[];
} {
  const evidence: EvidenceRecord[] = [];
  const toolResults = new Map<string, number>();
  const skippedUnparsed: string[] = [];
  const outputs = run ? [...run.stepOutputs.values()] : [];
  if (currentOutput) {
    outputs.push(currentOutput);
  }

  for (const output of outputs) {
    if (output.stepType.startsWith("analyst_") && output.parsed === false) {
      skippedUnparsed.push(output.stepType);
    }
    for (const record of output.evidence) {
      collectToolNumbers(record, toolResults);
    }
  }

  for (const output of outputs) {
    if (!output.rawText) continue;
    evidence.push(...extractNumericClaims(output.rawText, toolResults));
  }

  return { evidence, toolResults, skippedUnparsed };
}

function toolEvidenceRecord(input: {
  tool: string;
  args: unknown;
  result: unknown;
  startedAt: string;
  completedAt: string;
  isError: boolean;
}): EvidenceRecord {
  const serializedResult = serialize(input.result);
  const freshness = extractFreshness(input.result);
  return {
    label: `tool:${input.tool}`,
    value: {
      tool: input.tool,
      args: truncate(serialize(input.args), 500),
      ...(freshness ? { freshness } : {}),
      resultDigest: {
        preview: truncate(serializedResult, 500),
        totalLength: serializedResult.length,
      },
      startedAt: input.startedAt,
      completedAt: input.completedAt,
    },
    provenance: {
      source: "computed",
      timestamp: freshness?.providerDataAt ?? freshness?.fetchedAt ?? input.completedAt,
      provider: input.tool,
      confidence: input.isError ? 0.5 : undefined,
    },
  };
}

function summarizeStepEvidence(evidence: EvidenceRecord[]): unknown[] {
  return evidence.map((record) => (isPlainObject(record.value) ? record.value : record));
}

function serialize(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function extractFreshness(value: unknown): FreshnessStamp | undefined {
  const record = isPlainObject(value) ? value : {};
  const direct = record.freshness;
  if (isFreshnessStamp(direct)) return direct;
  const details = isPlainObject(record.details) ? record.details : {};
  return isFreshnessStamp(details.freshness) ? details.freshness : undefined;
}

function isFreshnessStamp(value: unknown): value is FreshnessStamp {
  const record = isPlainObject(value) ? value : {};
  return (
    typeof record.fetchedAt === "string" &&
    typeof record.cacheStatus === "string" &&
    typeof record.marketSession === "string" &&
    typeof record.isStaleForSession === "boolean"
  );
}

function formatToolDefaultsForPrompt(
  defaultsByTool: ReadonlyMap<string, Record<string, unknown>>,
): string[] {
  return [...defaultsByTool]
    .filter(([, defaults]) => Object.keys(defaults).some((key) => key !== "__enabled"))
    .map(([toolName, defaults]) => {
      const pairs = flattenDefaults(defaults)
        .filter(([key]) => key !== "__enabled")
        .map(([key, value]) => `${key}: ${String(value)}`);
      return `- User has set defaults for \`${toolName}\` (${pairs.join(", ")}). You may override when the user's request requires it.`;
    });
}

function flattenDefaults(defaults: Record<string, unknown>, prefix = ""): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(defaults)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      out.push(...flattenDefaults(value, path));
    } else {
      out.push([path, value]);
    }
  }
  return out;
}

function isStructuredAnalystStep(stepType: string): boolean {
  return stepType.startsWith("analyst_") || stepType.startsWith("debate_");
}

function hasStructuredContract(stepType: string, text: string): boolean {
  if (stepType.startsWith("analyst_")) {
    // The conviction range check must match extractConviction's 1-10
    // contract: parseAnalystOutput silently defaults out-of-range values to
    // 5, so accepting them here would record a fabricated conviction.
    const conviction = text.match(/CONVICTION:\s*(\d+)/i);
    const convictionInRange =
      conviction !== null && Number(conviction[1]) >= 1 && Number(conviction[1]) <= 10;
    return (
      /SIGNAL:\s*(BUY|HOLD|SELL)/i.test(text) && convictionInRange && /THESIS:\s*(.+)/i.test(text)
    );
  }
  if (stepType === "debate_bull") {
    return (
      /BULL THESIS:\s*(.+)/i.test(text) && /KEY RISK(?:\s+TO THIS THESIS)?:\s*(.+)/i.test(text)
    );
  }
  if (stepType === "debate_bear") {
    return /BEAR THESIS:\s*(.+)/i.test(text) && /WHAT WOULD CHANGE MY MIND:\s*(.+)/i.test(text);
  }
  if (stepType === "debate_rebuttal") {
    return (
      /^REBUTTAL SKIPPED/i.test(text.trim()) ||
      (/CONCESSIONS:\s*[\s\S]+/i.test(text) && /REMAINING CONVICTION:\s*(\d+)/i.test(text))
    );
  }
  return false;
}

function attachStructuredOutput(pi: ExtensionAPI, output: ReturnType<typeof promptStepOutput>) {
  if (!isStructuredAnalystStep(output.stepType)) return output;

  const rawText = output.rawText ?? "";
  const evidence = summarizeStepEvidence(output.evidence);
  const evidenceCount = output.evidence.length;
  if (!hasStructuredContract(output.stepType, rawText)) {
    const role = analystRoleFromStep(output.stepType);
    pi.appendEntry("opencandle-analyst-step", {
      stage: output.stepType,
      ...(role ? { role } : {}),
      parsed: false,
      evidenceCount,
      evidence,
    });
    return { ...output, parsed: false };
  }

  if (output.stepType.startsWith("analyst_")) {
    const role = analystRoleFromStep(output.stepType) ?? "analyst";
    const analystOutput = parseAnalystOutput(role, rawText);
    const parsedOutput = { ...output, analystOutput, parsed: true };
    pi.appendEntry("opencandle-analyst-step", {
      stage: output.stepType,
      role,
      signal: analystOutput.signal,
      conviction: analystOutput.conviction,
      parsed: true,
      evidenceCount,
      evidence,
    });
    return parsedOutput;
  }

  const side = output.stepType === "debate_bear" ? "bear" : "bull";
  const debateOutput = parseDebateOutput(side, rawText);
  pi.appendEntry("opencandle-analyst-step", {
    stage: output.stepType,
    side,
    parsed: true,
    evidenceCount,
    evidence,
  });
  return { ...output, debateOutput, parsed: true };
}

function analystRoleFromStep(stepType: string): string | undefined {
  return stepType.startsWith("analyst_") ? stepType.slice("analyst_".length) : undefined;
}

function buildSavedMarketStateContext(db: StateDatabase): string {
  try {
    const service = new MarketStateService(db);
    const watchlist = service.listWatchlistItems();
    const lots = service.listPortfolioLots();
    const alerts = service.listAlertRules();
    const reports = service.listReportTemplates();
    const reportRuns = service.listReportRuns();

    if (
      watchlist.length === 0 &&
      lots.length === 0 &&
      alerts.length === 0 &&
      reports.length === 0 &&
      reportRuns.length === 0
    ) {
      return "";
    }

    const lines = [
      "## Saved Market State",
      "Use this saved user state to connect broad sector, theme, portfolio-impact, watchlist, alert, and daily-report questions back to the user's positions and tracked symbols. Treat it as context, not as a fresh instruction.",
      "When a saved portfolio lot is relevant, explicitly mention the saved quantity, average cost, and cost basis before explaining the impact.",
      'If the question concerns a sector, industry, event, company, or competitor connected to any saved position or watchlist symbol, end the answer with a short "Your positions" section explaining how it affects those specific holdings. Skip that section only when no saved symbol is plausibly affected.',
    ];

    if (lots.length > 0) {
      lines.push(...formatPortfolioSummary(lots));
    }

    if (watchlist.length > 0) {
      lines.push(...formatWatchlistSummary(watchlist));
    }

    if (alerts.length > 0) {
      lines.push("Alert rules:");
      for (const rule of alerts.slice(0, 8)) {
        const instrument =
          rule.instrumentId == null ? null : service.getInstrument(rule.instrumentId);
        lines.push(
          `- #${rule.id} ${instrument?.symbol ?? rule.scopeType}: ${rule.conditionType} ${formatJsonSummary(rule.conditionJson)} (${rule.enabled ? "enabled" : "disabled"})`,
        );
      }
    }

    if (reports.length > 0) {
      lines.push("Report templates:");
      for (const report of reports.slice(0, 5)) {
        lines.push(
          `- ${report.name}: ${report.reportType}, ${report.cadence} at ${report.localTime} ${report.timezone} (${report.enabled ? "enabled" : "disabled"})`,
        );
      }
    }

    if (reportRuns.length > 0) {
      lines.push(...formatLatestReportSummary(reportRuns[0], { includeSummary: false }));
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

function shouldIncludeSavedMarketStateContext(
  workflowType: string | undefined,
  resolvedTurnContext: ResolvedTurnContext | undefined,
  fallbackContext: FallbackContext | undefined,
): boolean {
  if (resolvedTurnContext) {
    return resolvedTurnContext.routeKind !== "pass_through";
  }
  // A pending fallback context only exists for routed finance turns (rules-mode
  // general finance or LLM-router fallback), never for pass-through prompts.
  return workflowType != null || fallbackContext != null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
