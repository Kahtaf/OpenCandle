import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  AgentTool as PiAgentTool,
} from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "@sinclair/typebox";

// Pi 1.5 validates JSON Schema but cannot infer all legacy TypeBox schemas.
// Preserve TypeBox argument inference, as Pi does for its own built-in tools.
export type AgentTool<TParams extends TSchema = TSchema, TDetails = unknown> = Omit<
  PiAgentTool<TParams, TDetails>,
  "execute" | "prepareArguments"
> & {
  prepareArguments?: (args: unknown) => Static<TParams>;
  execute(
    toolCallId: string,
    params: Static<TParams>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ): Promise<AgentToolResult<TDetails>>;
};
