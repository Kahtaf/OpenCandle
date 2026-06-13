import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";
import { agentToolToPiTool } from "./pi/tool-adapter.js";

export type { AgentTool } from "@earendil-works/pi-agent-core";
export type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export { Type } from "@sinclair/typebox";
// Re-exports for tool authors — import from "opencandle/tool-kit"
export { Cache, cache, TTL } from "./infra/cache.js";
export { type HttpClientOptions, HttpError, httpGet } from "./infra/http-client.js";
export { RateLimiter, rateLimiter } from "./infra/rate-limiter.js";
export { agentToolToPiTool } from "./pi/tool-adapter.js";

// Module-level registry — all extensions run in the same Node.js process,
// so keep a deduped index keyed by tool name.
const addonToolRegistry = new Map<string, { name: string; description: string }>();

export function getAddonToolDescriptions(): ReadonlyArray<{ name: string; description: string }> {
  return Array.from(addonToolRegistry.values());
}

const SNAKE_CASE_VERB_RE =
  /^(get|analyze|search|calculate|compare|compute|track|manage|backtest|list|fetch|check)_[a-z][a-z0-9_]*$/;

export interface ToolConfig<TParams extends TSchema, TDetails = unknown> {
  name: string;
  label: string;
  description: string;
  parameters: TParams;
  execute: AgentTool<TParams, TDetails>["execute"];
}

export function createTool<TParams extends TSchema, TDetails = unknown>(
  config: ToolConfig<TParams, TDetails>,
): AgentTool<TParams, TDetails> {
  if (!config.name || !SNAKE_CASE_VERB_RE.test(config.name)) {
    throw new Error(
      `Invalid tool name "${config.name}": must be snake_case and start with a verb prefix ` +
        `(get_, analyze_, search_, calculate_, compare_, compute_, track_, manage_, backtest_, list_, fetch_, check_)`,
    );
  }
  if (!config.description || config.description.trim().length === 0) {
    throw new Error(`Tool "${config.name}" requires a non-empty description`);
  }
  if (!config.parameters) {
    throw new Error(`Tool "${config.name}" requires parameters (Typebox schema)`);
  }
  return {
    name: config.name,
    label: config.label,
    description: config.description,
    parameters: config.parameters,
    execute: config.execute,
  };
}

export function registerTools<TParams extends TSchema>(
  pi: ExtensionAPI,
  tools: AgentTool<TParams>[],
): void {
  for (const tool of tools) {
    if (addonToolRegistry.has(tool.name)) {
      console.warn(`[opencandle] Warning: tool "${tool.name}" already registered (overwriting)`);
    }
    pi.registerTool(agentToolToPiTool(tool));
    addonToolRegistry.set(tool.name, { name: tool.name, description: tool.description });
  }
}
