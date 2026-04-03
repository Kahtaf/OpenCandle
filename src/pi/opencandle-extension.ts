import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  isAnalysisRequest,
  normalizeSymbol,
} from "../analysts/orchestrator.js";
import { buildComprehensiveAnalysisDefinition } from "../analysts/orchestrator.js";
import { classifyIntent, resolveOptionsScreenerSlots, resolvePortfolioSlots } from "../routing/index.js";
import type { CompareAssetsSlots, SlotResolution } from "../routing/types.js";
import {
  buildPortfolioWorkflowDefinition,
  buildOptionsScreenerWorkflowDefinition,
  buildCompareAssetsWorkflowDefinition,
} from "../workflows/index.js";
import { getOpenCandleToolDefinitions } from "./tool-adapter.js";
import { registerAskUserTool } from "../tools/interaction/ask-user.js";
import { SessionCoordinator } from "../runtime/session-coordinator.js";

export default function openCandleExtension(pi: ExtensionAPI): void {
  const coordinator = new SessionCoordinator();

  // Register tools
  for (const tool of getOpenCandleToolDefinitions()) {
    pi.registerTool(tool);
  }
  registerAskUserTool(pi);

  // /analyze command
  pi.registerCommand("analyze", {
    description: "Run the multi-analyst OpenCandle workflow for a ticker symbol",
    handler: async (args, ctx) => {
      const symbol = normalizeSymbol(args);
      if (!symbol) {
        ctx.ui.notify("Usage: /analyze <ticker>", "warning");
        return;
      }
      const definition = buildComprehensiveAnalysisDefinition(symbol);
      coordinator.executeWorkflow(pi, definition, ctx);
    },
  });

  // /setup command
  pi.registerCommand("setup", {
    description: "Run OpenCandle setup for your AI model and market data providers",
    handler: async (_args, ctx) => {
      const result = await coordinator.runSetup(pi, ctx, { mode: "manual", forceFinancePrompt: true });
      if (result === "ready") {
        ctx.ui.notify("OpenCandle setup complete.", "info");
      }
    },
  });

  // Session start
  pi.on("session_start", async (_event, ctx) => {
    coordinator.initSession(ctx.sessionManager.getSessionId());

    if (!ctx.hasUI) return;
    const result = await coordinator.runSetup(pi, ctx, { mode: "startup" });
    if (result === "shutdown") {
      return;
    }
    ctx.ui.notify(
      "OpenCandle finance mode. Try /analyze NVDA or ask for quotes, options, macro, or portfolio analysis.",
      "info",
    );
  });

  // Input handling — classify intent and dispatch workflows
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return;

    // Extract and persist user preferences
    coordinator.extractAndStorePreferences(event.text);
    const storage = coordinator.getStorage();
    const workflowPrefs = storage?.getWorkflowPreferences("global") ?? {};

    // Check for comprehensive analysis pattern
    const analysis = isAnalysisRequest(event.text);
    if (analysis.match && analysis.symbol) {
      const definition = buildComprehensiveAnalysisDefinition(analysis.symbol);
      coordinator.executeWorkflow(pi, definition, ctx);
      return { action: "handled" };
    }

    // Classify intent
    const classification = classifyIntent(event.text);

    if (classification.workflow === "portfolio_builder") {
      const resolution = resolvePortfolioSlots(classification.entities, workflowPrefs);
      coordinator.recordWorkflowRun("portfolio_builder", classification.entities, resolution.resolved, resolution.defaultsUsed);
      pi.appendEntry("opencandle-workflow", { workflow: "portfolio_builder", entities: classification.entities, resolved: resolution.resolved });
      const definition = buildPortfolioWorkflowDefinition(resolution);
      coordinator.executeWorkflow(pi, definition, ctx);
      return { action: "handled" };
    }

    if (classification.workflow === "options_screener") {
      const resolution = resolveOptionsScreenerSlots(classification.entities, workflowPrefs);
      if (resolution.missingRequired.length === 0) {
        coordinator.recordWorkflowRun("options_screener", classification.entities, resolution.resolved, resolution.defaultsUsed);
        pi.appendEntry("opencandle-workflow", { workflow: "options_screener", entities: classification.entities, resolved: resolution.resolved });
        const definition = buildOptionsScreenerWorkflowDefinition(resolution);
        coordinator.executeWorkflow(pi, definition, ctx);
        return { action: "handled" };
      }
    }

    if (classification.workflow === "compare_assets" && classification.entities.symbols.length >= 2) {
      const resolution: SlotResolution<CompareAssetsSlots> = {
        resolved: { symbols: classification.entities.symbols },
        sources: { symbols: "user" },
        defaultsUsed: [],
        missingRequired: [],
      };
      coordinator.recordWorkflowRun("compare_assets", classification.entities, resolution.resolved, resolution.defaultsUsed);
      pi.appendEntry("opencandle-workflow", { workflow: "compare_assets", symbols: classification.entities.symbols });
      const definition = buildCompareAssetsWorkflowDefinition(resolution);
      coordinator.executeWorkflow(pi, definition, ctx);
      return { action: "handled" };
    }
  });

  // System prompt assembly — delegate to coordinator
  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: coordinator.buildSystemPrompt(event.systemPrompt),
    };
  });
}
