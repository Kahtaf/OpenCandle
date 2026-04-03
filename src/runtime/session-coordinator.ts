import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { initDefaultDatabase, MemoryStorage } from "../memory/index.js";
import { MemoryManager } from "../memory/manager.js";
import { extractPreferences } from "../memory/preference-extractor.js";
import { runOpenCandleSetup } from "../pi/setup.js";
import { WorkflowEventLogger } from "./workflow-events.js";
import { ProviderTracker } from "./provider-tracker.js";
import { WorkflowRunner } from "./workflow-runner.js";
import { PromptContextBuilder } from "../prompts/context-builder.js";
import { getThirdPartyToolDescriptions } from "../tool-kit.js";
import type { WorkflowDefinition } from "./prompt-step.js";
import { toStepDefinitions, promptStepOutput } from "./prompt-step.js";
import type Database from "better-sqlite3";

const PROMPT_SETTLE_POLL_MS = 25;
const IMMEDIATE_IDLE_GRACE_MS = 100;

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
  private sessionId = "unknown";

  constructor() {
    // Runner is always available — event logger is optional and added after session init
    this.runner = new WorkflowRunner({ providerTracker: new ProviderTracker() });
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
    this.runner = new WorkflowRunner({
      eventLogger: this.eventLogger,
      providerTracker: new ProviderTracker(),
    });
    this.sessionId = sessionId;
  }

  /** Run setup flow. */
  async runSetup(
    pi: ExtensionAPI,
    ctx: ExtensionCommandContext,
    options: { mode: "startup" | "manual"; forceFinancePrompt?: boolean },
  ): Promise<"ready" | "shutdown"> {
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
  recordWorkflowRun(workflowType: string, entities: Record<string, unknown>, resolved: Record<string, unknown>, defaultsUsed: unknown[]): void {
    this.storage?.insertWorkflowRun({
      sessionId: this.sessionId,
      workflowType,
      inputSlotsJson: JSON.stringify(entities),
      resolvedSlotsJson: JSON.stringify(resolved),
      defaultsUsedJson: JSON.stringify(defaultsUsed),
    });
  }

  /** Build system prompt using composable sections. */
  buildSystemPrompt(basePrompt: string, workflowType?: string): string {
    const builder = new PromptContextBuilder();

    const thirdPartyTools = getThirdPartyToolDescriptions();
    const thirdPartyDescriptions = thirdPartyTools.length > 0
      ? thirdPartyTools.map((t) => `${t.name}: ${t.description}`)
      : undefined;

    const memoryContext = this.memoryManager
      ? this.memoryManager.buildContext(workflowType ?? "unclassified")
      : undefined;

    builder.populateFromOptions({
      workflowType,
      memoryContext: memoryContext || undefined,
      thirdPartyToolDescriptions: thirdPartyDescriptions,
    });

    return `${basePrompt}\n\n${builder.build()}`;
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
    });
  }

  /** Cancel any active workflow. */
  cancelActiveWorkflow(): void {
    this.runner?.cancel();
  }
}
