import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";
import { runWithAbortSignal } from "../infra/abort-context.js";

/**
 * How long a tool may take to settle on its own after Stop before the adapter
 * gives up on it. Tools that honour the abort (an ask_user question settling
 * as cancelled) keep their own result; one that ignores it no longer holds the
 * run, and with it the session, open until it finishes.
 */
export const TOOL_ABORT_GRACE_MS = 200;

const ABORTED_MESSAGE = "Operation aborted";

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
      if (signal?.aborted) throw new Error(ABORTED_MESSAGE);
      // Provider fetches made anywhere inside the tool see the run's signal.
      const execution = runWithAbortSignal(signal, () =>
        executeWithContext(toolCallId, params, signal, onUpdate, ctx),
      );
      if (!signal) return execution;
      return settleOrAbandonOnAbort(execution, signal);
    },
  };
}

function settleOrAbandonOnAbort<T>(execution: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      graceTimer = setTimeout(() => reject(new Error(ABORTED_MESSAGE)), TOOL_ABORT_GRACE_MS);
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      if (graceTimer) clearTimeout(graceTimer);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    execution.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
