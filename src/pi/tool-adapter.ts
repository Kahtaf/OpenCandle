import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";
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

export function getVantageToolDefinitions(): ToolDefinition[] {
  return getAllTools().map((tool) => agentToolToPiTool(tool));
}
