import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { MarketStateService } from "../../../src/market-state/service.js";
import { getHostedOpenCandleToolDefinitions } from "../../../src/pi/hosted-tool-adapter.js";
import { agentToolToPiTool } from "../../../src/pi/tool-adapter-core.js";
import type { StateDatabase } from "../../../src/runtime/state-database.js";
import { alertsTool } from "../../../src/tools/portfolio/alerts.js";
import { dailyReportTool } from "../../../src/tools/portfolio/daily-report.js";
import { notificationsTool } from "../../../src/tools/portfolio/notifications.js";
import { portfolioTrackerTool } from "../../../src/tools/portfolio/tracker.js";
import { watchlistTool } from "../../../src/tools/portfolio/watchlist.js";
import { invokeHostedMarketStateTool } from "./hosted-market-state-actions.js";

const STATEFUL_TOOLS = [
  watchlistTool,
  portfolioTrackerTool,
  alertsTool,
  dailyReportTool,
  notificationsTool,
] as const;

/**
 * Browser-hosted tool composition.
 *
 * The contracts come from the same canonical AgentTool objects used by the
 * local GUI and TUI. Only execution is rebound to the browser-owned SQLite
 * database, with background-only actions failing explicitly.
 */
export function getBrowserHostedToolDefinitions(options: {
  stateDatabase: StateDatabase;
  relayProviders?: readonly string[];
}): ToolDefinition[] {
  const service = new MarketStateService(options.stateDatabase);
  const stateful = STATEFUL_TOOLS.map((tool) => {
    const definition = agentToolToPiTool(tool);
    return {
      ...definition,
      execute: async (toolCallId: string, args: unknown) => {
        const invoked = await invokeHostedMarketStateTool(
          service,
          definition.name,
          (args ?? {}) as Record<string, unknown>,
          toolCallId,
        );
        return invoked.result;
      },
    } as ToolDefinition;
  });
  return [
    ...getHostedOpenCandleToolDefinitions({ relayProviders: options.relayProviders }),
    ...stateful,
  ];
}
