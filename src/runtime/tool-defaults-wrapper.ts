import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";

export function wrapWithDefaults<TParams extends TSchema, TDetails>(
  tool: AgentTool<TParams, TDetails>,
  defaults: Record<string, unknown>,
): AgentTool<TParams, TDetails> {
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate, ctx?: unknown) => {
      const merged = mergeDefaults(defaults, params as Record<string, unknown>);
      const executeWithContext = tool.execute as unknown as (
        id: string,
        params: unknown,
        signal?: AbortSignal,
        onUpdate?: unknown,
        ctx?: unknown,
      ) => ReturnType<typeof tool.execute>;
      if (ctx === undefined) {
        return executeWithContext(toolCallId, merged, signal, onUpdate);
      }
      return executeWithContext(toolCallId, merged, signal, onUpdate, ctx);
    },
  };
}

function mergeDefaults(
  defaults: Record<string, unknown>,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (Object.keys(defaults).length === 0) return args;

  const out: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(args)) {
    const base = out[key];
    out[key] = isPlainObject(base) && isPlainObject(value) ? mergeDefaults(base, value) : value;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
