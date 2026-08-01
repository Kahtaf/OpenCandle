import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getHostedOpenCandleToolDefinitions } from "../../../src/pi/hosted-tool-adapter.js";
import { agentToolToPiTool } from "../../../src/pi/tool-adapter-core.js";
import type { StateDatabase } from "../../../src/runtime/state-database.js";
import { createAlertsTool } from "../../../src/tools/portfolio/alerts.js";
import { createDailyReportTool } from "../../../src/tools/portfolio/daily-report.js";
import { createNotificationsTool } from "../../../src/tools/portfolio/notifications.js";
import type { StatefulToolOptions } from "../../../src/tools/portfolio/stateful-tool-options.js";
import { createPortfolioTrackerTool } from "../../../src/tools/portfolio/tracker.js";
import { createWatchlistTool } from "../../../src/tools/portfolio/watchlist.js";

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
  marketStateDependencies?: Pick<StatefulToolOptions, "resolveInstrument" | "getCurrentPrice">;
}): ToolDefinition[] {
  const statefulOptions: StatefulToolOptions = {
    stateDatabaseFactory: () => options.stateDatabase,
    closeDatabaseAfterExecute: false,
    allowUnverifiedExactSymbols: true,
    ...options.marketStateDependencies,
  };
  const stateful = [
    createWatchlistTool(statefulOptions),
    createPortfolioTrackerTool(statefulOptions),
    createAlertsTool(statefulOptions),
    createDailyReportTool(statefulOptions),
    createNotificationsTool(statefulOptions),
  ].map(agentToolToPiTool);
  return [
    ...getHostedOpenCandleToolDefinitions({ relayProviders: options.relayProviders }),
    ...stateful,
  ];
}
