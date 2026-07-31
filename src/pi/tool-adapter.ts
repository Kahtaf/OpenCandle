import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getDefaults } from "../memory/tool-defaults.js";
import { wrapWithDefaults } from "../runtime/tool-defaults-wrapper.js";
import { getAllTools } from "../tools/index.js";
import type { AskUserHandler } from "../types/index.js";
import { agentToolToPiTool } from "./tool-adapter-core.js";

export { agentToolToPiTool } from "./tool-adapter-core.js";

export function getOpenCandleToolDefinitions(
  options: { askUserHandler?: AskUserHandler } = {},
): ToolDefinition[] {
  return getAllTools(options)
    .map((tool) => ({ tool, defaults: safeGetDefaults(tool.name) }))
    .filter(({ defaults }) => defaults.__enabled !== false)
    .map(({ tool, defaults }) => {
      const { __enabled: _enabled, ...paramDefaults } = defaults;
      return agentToolToPiTool(wrapWithDefaults(tool, paramDefaults));
    });
}

function safeGetDefaults(toolName: string): Record<string, unknown> {
  try {
    return getDefaults(toolName);
  } catch {
    return {};
  }
}
