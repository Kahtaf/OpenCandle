import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { buildSystemPrompt } from "../system-prompt.js";
import {
  getComprehensiveAnalysisPrompts,
  isAnalysisRequest,
  normalizeSymbol,
} from "../analysts/orchestrator.js";
import { classifyIntent, resolveOptionsScreenerSlots, resolvePortfolioSlots } from "../routing/index.js";
import type { CompareAssetsSlots, SlotResolution } from "../routing/types.js";
import { buildCompareAssetsWorkflow, buildOptionsScreenerWorkflow, buildPortfolioWorkflow } from "../workflows/index.js";
import { getVantageToolDefinitions } from "./tool-adapter.js";

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
  isCurrentSequence: () => boolean,
): Promise<boolean> {
  let sawBusyOrPending = !isReadyForNextPrompt(ctx);
  const startedAt = Date.now();

  while (isCurrentSequence()) {
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

function queuePromptSequence(
  pi: ExtensionAPI,
  prompts: string[],
  ctx: QueueContext,
  beginSequence: () => number,
  isCurrentSequence: (sequenceId: number) => boolean,
): void {
  if (prompts.length === 0) return;

  const [initialPrompt, ...followUps] = prompts;
  const sequenceId = beginSequence();
  const startedBusy = !isReadyForNextPrompt(ctx);

  if (startedBusy) {
    pi.sendUserMessage(initialPrompt, { deliverAs: "followUp" });
    ctx.ui?.notify?.("Analysis queued as follow-up.", "info");
  } else {
    pi.sendUserMessage(initialPrompt);
  }

  // Submit workflow prompts one turn at a time so a newer workflow can cancel
  // the remaining prompts before they are handed to Pi's internal follow-up queue.
  void (async () => {
    for (const prompt of followUps) {
      const settled = await waitForPromptSettlement(ctx, () => isCurrentSequence(sequenceId));
      if (!settled || !isCurrentSequence(sequenceId)) {
        return;
      }
      pi.sendUserMessage(prompt);
    }
  })();
}

function queueComprehensiveAnalysis(
  pi: ExtensionAPI,
  symbol: string,
  ctx: QueueContext,
  beginSequence: () => number,
  isCurrentSequence: (sequenceId: number) => boolean,
): void {
  queuePromptSequence(pi, getComprehensiveAnalysisPrompts(symbol), ctx, beginSequence, isCurrentSequence);
}

function queueCompareWorkflow(
  pi: ExtensionAPI,
  symbols: string[],
  ctx: QueueContext,
  beginSequence: () => number,
  isCurrentSequence: (sequenceId: number) => boolean,
): void {
  const resolution: SlotResolution<CompareAssetsSlots> = {
    resolved: { symbols },
    sources: { symbols: "user" },
    defaultsUsed: [],
    missingRequired: [],
  };
  const workflow = buildCompareAssetsWorkflow(resolution);
  queuePromptSequence(pi, [workflow.initialPrompt, ...workflow.followUps], ctx, beginSequence, isCurrentSequence);
}

export default function vantageExtension(pi: ExtensionAPI): void {
  let activeSequenceId = 0;
  const beginSequence = (): number => {
    activeSequenceId += 1;
    return activeSequenceId;
  };
  const isCurrentSequence = (sequenceId: number): boolean => sequenceId === activeSequenceId;

  for (const tool of getVantageToolDefinitions()) {
    pi.registerTool(tool);
  }

  pi.registerCommand("analyze", {
    description: "Run the multi-analyst Vantage workflow for a ticker symbol",
    handler: async (args, ctx) => {
      const symbol = normalizeSymbol(args);
      if (!symbol) {
        ctx.ui.notify("Usage: /analyze <ticker>", "warning");
        return;
      }
      queueComprehensiveAnalysis(pi, symbol, ctx, beginSequence, isCurrentSequence);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.notify(
      "Vantage finance mode. Try /analyze NVDA or ask for quotes, options, macro, or portfolio analysis.",
      "info",
    );
  });

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return;
    const analysis = isAnalysisRequest(event.text);
    if (analysis.match && analysis.symbol) {
      queueComprehensiveAnalysis(pi, analysis.symbol, ctx, beginSequence, isCurrentSequence);
      return { action: "handled" };
    }

    const classification = classifyIntent(event.text);

    if (classification.workflow === "portfolio_builder") {
      const workflow = buildPortfolioWorkflow(resolvePortfolioSlots(classification.entities));
      queuePromptSequence(pi, [workflow.initialPrompt, ...workflow.followUps], ctx, beginSequence, isCurrentSequence);
      return { action: "handled" };
    }

    if (classification.workflow === "options_screener") {
      const resolution = resolveOptionsScreenerSlots(classification.entities);
      if (resolution.missingRequired.length === 0) {
        const workflow = buildOptionsScreenerWorkflow(resolution);
        queuePromptSequence(pi, [workflow.initialPrompt, ...workflow.followUps], ctx, beginSequence, isCurrentSequence);
        return { action: "handled" };
      }
    }

    if (classification.workflow === "compare_assets" && classification.entities.symbols.length >= 2) {
      queueCompareWorkflow(pi, classification.entities.symbols, ctx, beginSequence, isCurrentSequence);
      return { action: "handled" };
    }
  });

  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildSystemPrompt()}`,
    };
  });
}
