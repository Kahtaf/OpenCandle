import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { initDefaultDatabase, MemoryStorage } from "../memory/index.js";
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
import type Database from "better-sqlite3";

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

    if (!sawBusyOrPending && ready && Date.now() - startedAt >= IMMEDIATE_IDLE_GRACE_MS) {
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
    turnType: "workflow" | "fallback" = "workflow",
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
   * Expose prior turns + recent runs + profile snapshot for the router
   * input context. Fixed-window per design.md §7 (last 5 turns, 3 runs).
   */
  buildRouterContextBase(): {
    profileSnapshot: Record<string, unknown>;
    recentWorkflowRuns: Array<{
      workflowType: string;
      turnType: string;
      resolvedSlots?: Record<string, unknown>;
      createdAt: string;
    }>;
  } {
    if (!this.storage) {
      return { profileSnapshot: {}, recentWorkflowRuns: [] };
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
    return { profileSnapshot, recentWorkflowRuns: runs };
  }

  /** Build system prompt using composable sections. */
  buildSystemPrompt(
    basePrompt: string,
    workflowType?: string,
    fallbackContext?: FallbackContext,
  ): string {
    const builder = new PromptContextBuilder();

    const addonTools = getAddonToolDescriptions();
    const addonDescriptions = addonTools.length > 0
      ? addonTools.map((t) => `${t.name}: ${t.description}`)
      : undefined;

    const memoryContext = this.memoryManager
      ? this.memoryManager.buildContext(workflowType ?? "unclassified")
      : undefined;

    builder.populateFromOptions({
      workflowType,
      memoryContext: memoryContext || undefined,
      addonToolDescriptions: addonDescriptions,
      fallbackContext,
    });

    return `${basePrompt}\n\n${builder.build()}`;
  }

  /**
   * Stash a pending fallback context so the very next `before_agent_start`
   * hook can slot it into the system prompt. Cleared after consumption so
   * subsequent turns do not inherit stale fallback directives.
   */
  private pendingFallbackContext: FallbackContext | null = null;

  setPendingFallbackContext(ctx: FallbackContext | null): void {
    this.pendingFallbackContext = ctx;
  }

  consumePendingFallbackContext(): FallbackContext | null {
    const ctx = this.pendingFallbackContext;
    this.pendingFallbackContext = null;
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
    if (definition.steps.length === 0) return;

    const runner = this.runner;
    const runRef = { active: true };

    // Send the first prompt immediately
    const [firstStep, ...restSteps] = definition.steps;
    const startedBusy = !isReadyForNextPrompt(ctx);

    if (startedBusy) {
      pi.sendUserMessage(firstStep.prompt, { deliverAs: "followUp" });
      ctx.ui?.notify?.("Analysis queued as follow-up.", "info");
    } else {
      pi.sendUserMessage(firstStep.prompt);
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
        const settled = await waitForPromptSettlement(ctx, () => runRef.active);
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
