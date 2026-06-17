import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";
import { getDefaults } from "../memory/tool-defaults.js";
import { wrapWithDefaults } from "../runtime/tool-defaults-wrapper.js";
import { getAllTools } from "../tools/index.js";
import type { AskUserHandler } from "../types/index.js";

export function agentToolToPiTool<TParams extends TSchema, TDetails>(
  tool: AgentTool<TParams, TDetails>,
): ToolDefinition<TParams, TDetails> {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    promptSnippet: `${tool.name}: ${tool.description}`,
    parameters: tool.parameters,
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      const executeWithContext = tool.execute as unknown as (
        id: string,
        params: unknown,
        signal: AbortSignal | undefined,
        onUpdate: unknown,
        ctx: unknown,
      ) => ReturnType<typeof tool.execute>;
      return executeWithContext(toolCallId, params, signal, onUpdate, ctx);
    },
  };
}

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
