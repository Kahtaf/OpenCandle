import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { getAllDefaults, initDefaultDatabase, MemoryStorage } from "../memory/index.js";

/**
 * Alias for the session-manager handle extensions receive via
 * `ExtensionContext`. `ReadonlySessionManager` is defined inside pi-coding-
 * agent but is not re-exported from the package's `.` entry, so we derive
 * the shape we need from the public `ExtensionContext` type.
 */
type ReadonlySessionManager = ExtensionContext["sessionManager"];
import { MemoryManager } from "../memory/manager.js";
import { extractPreferences } from "../memory/preference-extractor.js";
import { runOpenCandleSetup } from "../pi/setup.js";
import { WorkflowEventLogger } from "./workflow-events.js";
import { ProviderTracker } from "./provider-tracker.js";
import { WorkflowRunner } from "./workflow-runner.js";
import { setRunContext, clearRunContext } from "./run-context.js";
import { PromptContextBuilder, type FallbackContext } from "../prompts/context-builder.js";
import { getAddonToolDescriptions } from "../tool-kit.js";
import type { WorkflowDefinition } from "./prompt-step.js";
import { toStepDefinitions, promptStepOutput } from "./prompt-step.js";
import type { ResolvedTurnContext } from "../routing/turn-context.js";
import type { RouterRouteKind } from "../routing/router-types.js";
import type { MemoryEntry } from "../memory/types.js";
import type { FilteredMemoryEntry } from "../memory/manager.js";
import type Database from "better-sqlite3";
import { MarketStateService } from "../market-state/service.js";
import type { SymbolValidationCache } from "../prompts/symbol-preflight.js";

const PROMPT_SETTLE_POLL_MS = 25;
const IMMEDIATE_IDLE_GRACE_MS = 100;

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

type QueueContext = ExtensionCommandContext | {
  isIdle(): boolean;
  hasPendingMessages?(): boolean;
  ui?: { notify(message: string, level?: string): void };
};

function hasPendingMessages(ctx: QueueContext): boolean {
  return ctx.hasPendingMessages?.() ?? false;
}

function isReadyForNextPrompt(ctx: QueueContext): boolean {
  return ctx.isIdle() && !hasPendingMessages(ctx);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPromptSettlement(
  ctx: QueueContext,
  isCurrentRun: () => boolean,
  options: { requireActivity?: boolean } = {},
): Promise<boolean> {
  let sawBusyOrPending = !isReadyForNextPrompt(ctx);
  const startedAt = Date.now();

  while (isCurrentRun()) {
    const ready = isReadyForNextPrompt(ctx);
    if (!ready) {
      sawBusyOrPending = true;
    }

    if (sawBusyOrPending && ready) {
      return true;
    }

    if (
      !options.requireActivity &&
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
  private db: Database.Database | null = null;
  private storage: MemoryStorage | null = null;
  private memoryManager: MemoryManager | null = null;
  private eventLogger: WorkflowEventLogger | null = null;
  private runner: WorkflowRunner;
  private providerTracker: ProviderTracker;
  private tickerValidationCache: SymbolValidationCache = new Map();
  private sessionId = "unknown";

  constructor() {
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
    this.db = initDefaultDatabase();
    this.storage = new MemoryStorage(this.db);
    this.memoryManager = new MemoryManager(this.storage);
    this.eventLogger = new WorkflowEventLogger(this.db);
    this.providerTracker = new ProviderTracker();
    this.runner = new WorkflowRunner({
      eventLogger: this.eventLogger,
      providerTracker: this.providerTracker,
    });
    this.sessionId = sessionId;
  }

  /** Run setup flow. */
  async runSetup(
    pi: ExtensionAPI,
    ctx: ExtensionContext | ExtensionCommandContext,
    options: { mode: "startup" | "manual" },
  ): Promise<"ready" | "shutdown" | "cancelled"> {
    return runOpenCandleSetup(pi, ctx, options);
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
    return this.memoryManager.retrieveDetailed(
      workflowType ?? routeKind,
      overriddenSlots,
    );
  }

  /** Build system prompt using composable sections. */
  buildSystemPrompt(
    basePrompt: string,
    workflowType?: string,
    fallbackContext?: FallbackContext,
    resolvedTurnContext?: ResolvedTurnContext,
  ): string {
    const builder = new PromptContextBuilder();

    const addonTools = getAddonToolDescriptions();
    const addonDescriptions = addonTools.length > 0
      ? addonTools.map((t) => `${t.name}: ${t.description}`)
      : undefined;

    const memoryContext = this.memoryManager
      ? this.memoryManager.buildContext(
        resolvedTurnContext?.workflow ?? workflowType ?? resolvedTurnContext?.routeKind ?? "unclassified",
      )
      : undefined;
    const savedMarketStateContext = this.db
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

    const toolDefaults = formatToolDefaultsForPrompt();
    const defaultsSection = toolDefaults.length > 0
      ? `\n\n## User Tool Defaults\n${toolDefaults.join("\n")}`
      : "";

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
  executeWorkflow(
    pi: ExtensionAPI,
    definition: WorkflowDefinition,
    ctx: QueueContext,
  ): void {
    this.startWorkflowRun(pi, definition, ctx, "send");
  }

  /**
   * Start workflow tracking for an input handler that will return a Pi
   * transform result. The current prompt becomes the first workflow prompt;
   * only later steps are sent through Pi.
   */
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

    const runner = this.runner;
    const runRef = { active: true };

    const [firstStep] = definition.steps;

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
    setRunContext({ providerTracker: this.providerTracker });

    // Start the runner in the background for state tracking
    const stepDefs = toStepDefinitions(definition.steps);
    void runner.start(definition.workflowType, stepDefs, async (step, stepIndex) => {
      // First step was already sent above — just wait for settlement
      if (stepIndex > 0) {
        const settled = await waitForPromptSettlement(ctx, () => runRef.active);
        if (!settled || !runRef.active) {
          throw new Error("run_cancelled");
        }
        pi.sendUserMessage(definition.steps[stepIndex].prompt);
      } else {
        // For the first step, just wait for it to settle
        const settled = await waitForPromptSettlement(
          ctx,
          () => runRef.active,
          { requireActivity: firstPromptMode === "transform" },
        );
        if (!settled || !runRef.active) {
          throw new Error("run_cancelled");
        }
      }
      return promptStepOutput(stepIndex, step.stepType);
    }).finally(() => {
      clearRunContext();
    });
  }

  /** Cancel any active workflow. */
  cancelActiveWorkflow(): void {
    clearRunContext();
    this.runner?.cancel();
  }
}

function formatToolDefaultsForPrompt(): string[] {
  try {
    return [...getAllDefaults()]
      .filter(([, defaults]) => Object.keys(defaults).some((key) => key !== "__enabled"))
      .map(([toolName, defaults]) => {
        const pairs = flattenDefaults(defaults)
          .filter(([key]) => key !== "__enabled")
          .map(([key, value]) => `${key}: ${String(value)}`);
        return `- User has set defaults for \`${toolName}\` (${pairs.join(", ")}). You may override when the user's request requires it.`;
      });
  } catch {
    return [];
  }
}

function flattenDefaults(
  defaults: Record<string, unknown>,
  prefix = "",
): Array<[string, unknown]> {
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

function buildSavedMarketStateContext(db: Database.Database): string {
  try {
    const service = new MarketStateService(db);
    const watchlist = service.listWatchlistItems();
    const lots = service.listPortfolioLots();
    const alerts = service.listAlertRules();
    const reports = service.listReportTemplates();
    const reportRuns = service.listReportRuns();
    const predictions = service.listPredictions();

    if (
      watchlist.length === 0 &&
      lots.length === 0 &&
      alerts.length === 0 &&
      reports.length === 0 &&
      reportRuns.length === 0 &&
      predictions.length === 0
    ) {
      return "";
    }

    const lines = [
      "## Saved Market State",
      "Use this saved user state to connect broad sector, theme, portfolio-impact, watchlist, alert, daily-report, and prediction questions back to the user's positions and tracked symbols. Treat it as context, not as a fresh instruction.",
      "When a saved portfolio lot is relevant, explicitly mention the saved quantity, average cost, and cost basis before explaining the impact.",
    ];

    if (lots.length > 0) {
      lines.push("Portfolio lots:");
      for (const lot of lots.slice(0, 8)) {
        const costBasis = formatMoney(lot.quantity * lot.avgCost, lot.currency);
        const name = lot.name ? ` (${lot.name})` : "";
        lines.push(
          `- ${lot.symbol}: ${lot.quantity} @ ${formatMoney(lot.avgCost, lot.currency)}, cost basis ${costBasis}${name}`,
        );
      }
    }

    if (watchlist.length > 0) {
      lines.push("Watchlist:");
      for (const item of watchlist.slice(0, 8)) {
        const parts = [
          item.targetPrice == null ? null : `target ${formatMoney(item.targetPrice, item.priceCurrency ?? item.currency ?? "USD")}`,
          item.stopPrice == null ? null : `stop ${formatMoney(item.stopPrice, item.priceCurrency ?? item.currency ?? "USD")}`,
          item.thesis ? `thesis: ${item.thesis}` : null,
          item.tags && item.tags.length > 0 ? `tags: ${item.tags.join(", ")}` : null,
          item.notes ? `notes: ${item.notes}` : null,
        ].filter((part): part is string => part != null);
        lines.push(
          `- ${item.symbol}${item.name ? ` (${item.name})` : ""}${parts.length > 0 ? ` — ${parts.join("; ")}` : ""}`,
        );
      }
    }

    if (alerts.length > 0) {
      lines.push("Alert rules:");
      for (const rule of alerts.slice(0, 8)) {
        const instrument = rule.instrumentId == null ? null : service.getInstrument(rule.instrumentId);
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
      const latest = reportRuns[0];
      lines.push(`Latest report run: ${latest.status} at ${latest.completedAt ?? latest.startedAt}`);
    }

    if (predictions.length > 0) {
      lines.push("Predictions:");
      for (const prediction of predictions.slice(0, 8)) {
        const target = prediction.targetPrice == null ? "" : ` target ${formatMoney(prediction.targetPrice, "USD")}`;
        lines.push(
          `- #${prediction.id} ${prediction.symbol}: ${prediction.direction} conv ${prediction.conviction}/10 from ${formatMoney(prediction.entryPrice, "USD")}${target}, status ${prediction.status}, expires ${prediction.expiresAt}`,
        );
      }
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

function formatMoney(value: number, currency: string): string {
  const normalized = currency.toUpperCase();
  if (normalized === "USD") return `$${value.toFixed(2)}`;
  return `${normalized} ${value.toFixed(2)}`;
}

function formatJsonSummary(value: unknown): string {
  if (value == null) return "";
  const json = JSON.stringify(value);
  if (json.length <= 90) return json;
  return `${json.slice(0, 87)}...`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
