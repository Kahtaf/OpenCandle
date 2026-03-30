import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { buildSystemPrompt } from "../system-prompt.js";
import {
  getComprehensiveAnalysisPrompts,
  isAnalysisRequest,
  normalizeSymbol,
} from "../analysts/orchestrator.js";
import { getVantageToolDefinitions } from "./tool-adapter.js";

function queuePromptSequence(
  pi: ExtensionAPI,
  prompts: string[],
  ctx: ExtensionCommandContext | { isIdle(): boolean; ui?: { notify(message: string, level?: string): void } },
): void {
  if (prompts.length === 0) return;

  const [initialPrompt, ...followUps] = prompts;

  if (ctx.isIdle()) {
    void pi.sendUserMessage(initialPrompt);
    setTimeout(() => {
      for (const prompt of followUps) {
        void pi.sendUserMessage(prompt, { deliverAs: "followUp" });
      }
    }, 0);
    return;
  }

  void pi.sendUserMessage(initialPrompt, { deliverAs: "followUp" });
  for (const prompt of followUps) {
    void pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  }
  ctx.ui?.notify?.("Analysis queued as follow-up.", "info");
}

function queueComprehensiveAnalysis(
  pi: ExtensionAPI,
  symbol: string,
  ctx: ExtensionCommandContext | { isIdle(): boolean; ui?: { notify(message: string, level?: string): void } },
): void {
  queuePromptSequence(pi, getComprehensiveAnalysisPrompts(symbol), ctx);
}

export default function vantageExtension(pi: ExtensionAPI): void {
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
      queueComprehensiveAnalysis(pi, symbol, ctx);
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
    if (!analysis.match || !analysis.symbol) return;

    queueComprehensiveAnalysis(pi, analysis.symbol, ctx);
    return { action: "handled" };
  });

  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildSystemPrompt()}`,
    };
  });
}
