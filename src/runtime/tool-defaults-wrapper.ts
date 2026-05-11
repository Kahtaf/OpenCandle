import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";

export function wrapWithDefaults<TParams extends TSchema, TDetails>(
  tool: AgentTool<TParams, TDetails>,
  defaults: Record<string, unknown>,
): AgentTool<TParams, TDetails> {
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const merged = mergeDefaults(defaults, params as Record<string, unknown>);
      return tool.execute(toolCallId, merged as typeof params, signal, onUpdate);
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
    out[key] = isPlainObject(base) && isPlainObject(value)
      ? mergeDefaults(base, value)
      : value;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
