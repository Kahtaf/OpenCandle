import type { TSchema } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { agentToolToPiTool } from "./pi/tool-adapter.js";

// Re-exports for third-party tool authors — import from "opencandle/tool-kit"
export { cache, Cache, TTL } from "./infra/cache.js";
export { rateLimiter, RateLimiter } from "./infra/rate-limiter.js";
export { httpGet, HttpError, type HttpClientOptions } from "./infra/http-client.js";
export { agentToolToPiTool } from "./pi/tool-adapter.js";
export { Type } from "@sinclair/typebox";
export type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
export type { AgentTool } from "@mariozechner/pi-agent-core";

// Module-level registry — all extensions run in the same Node.js process,
// so keep a deduped index keyed by tool name.
const thirdPartyToolRegistry = new Map<string, { name: string; description: string }>();

export function getThirdPartyToolDescriptions(): ReadonlyArray<{ name: string; description: string }> {
  return Array.from(thirdPartyToolRegistry.values());
}

export interface RegisterToolsOptions {
  namespace?: string;
  description?: string;
}

export function registerOpenCandleTools<TParams extends TSchema>(
  pi: ExtensionAPI,
  tools: AgentTool<TParams>[],
  options?: RegisterToolsOptions,
): void {
  for (const tool of tools) {
    pi.registerTool(agentToolToPiTool(tool));
    thirdPartyToolRegistry.set(tool.name, { name: tool.name, description: tool.description });
  }
}
