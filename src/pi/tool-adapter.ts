import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getDefaults } from "../memory/tool-defaults.js";
import { wrapWithDefaults } from "../runtime/tool-defaults-wrapper.js";
import { getAllTools } from "../tools/index.js";
import type { AskUserHandler } from "../types/index.js";
import { agentToolToPiTool } from "./tool-adapter-core.js";

export { agentToolToPiTool } from "./tool-adapter-core.js";

/**
 * Tools that only fetch and format data, so Stop may abandon them (see
 * `abandonOnAbort`). An explicit allowlist: a new or add-on tool is awaited
 * until it is known to have no side effects.
 */
export const READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  "search_ticker",
  "get_stock_quote",
  "get_stock_history",
  "get_price_comparison",
  "screen_stocks",
  "get_crypto_price",
  "get_crypto_history",
  "get_company_overview",
  "get_financials",
  "get_earnings",
  "compute_dcf",
  "compare_companies",
  "get_sec_filings",
  "get_event_probabilities",
  "get_economic_data",
  "get_fear_greed",
  "get_technical_indicators",
  "backtest_strategy",
  "analyze_risk",
  "analyze_correlation",
  "analyze_holdings_overlap",
  "get_option_chain",
  "search_web",
  "get_sentiment_trend",
]);

export function getOpenCandleToolDefinitions(
  options: { askUserHandler?: AskUserHandler } = {},
): ToolDefinition[] {
  return getAllTools(options)
    .map((tool) => ({ tool, defaults: safeGetDefaults(tool.name) }))
    .filter(({ defaults }) => defaults.__enabled !== false)
    .map(({ tool, defaults }) => {
      const { __enabled: _enabled, ...paramDefaults } = defaults;
      return agentToolToPiTool(wrapWithDefaults(tool, paramDefaults), {
        abandonOnAbort: READ_ONLY_TOOL_NAMES.has(tool.name),
      });
    });
}

function safeGetDefaults(toolName: string): Record<string, unknown> {
  try {
    return getDefaults(toolName);
  } catch {
    return {};
  }
}
