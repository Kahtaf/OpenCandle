import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";

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
