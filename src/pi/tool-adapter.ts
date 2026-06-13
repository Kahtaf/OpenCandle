import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";
import { getDefaults } from "../memory/tool-defaults.js";
import { wrapWithDefaults } from "../runtime/tool-defaults-wrapper.js";
import { getAllTools } from "../tools/index.js";

export function agentToolToPiTool<TParams extends TSchema, TDetails>(
  tool: AgentTool<TParams, TDetails>,
): ToolDefinition<TParams, TDetails> {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    promptSnippet: `${tool.name}: ${tool.description}`,
    parameters: tool.parameters,
    execute: async (toolCallId, params, signal, onUpdate) => {
      return tool.execute(toolCallId, params, signal, onUpdate);
    },
  };
}

export function getOpenCandleToolDefinitions(): ToolDefinition[] {
  return getAllTools()
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
