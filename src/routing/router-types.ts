import type { ExtractedEntities, SlotSource, WorkflowType } from "./types.js";

export type RouterRoute = "workflow" | "fallback";
export type RouterRouteKind = "workflow_dispatch" | "agent_task" | "clarification" | "pass_through";

export type ToolBundleName =
  | "core_market"
  | "options"
  | "macro"
  | "sentiment"
  | "sec"
  | "clarification";

export type RouterConfidence = "high" | "medium" | "low";

export interface RouterSlot {
  value: unknown;
  source: SlotSource;
  confidence: RouterConfidence;
}

export interface RouterPreferenceUpdate {
  key: string;
  value: string;
  confidence: RouterConfidence;
  source: "inferred";
}

export interface RouterDiagnostic {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Structured output from the LLM router. Mirrors existing types
 * (`ClassificationResult`, `ExtractedEntities`, `SlotSource`) so downstream
 * consumers can branch without a new vocabulary.
 *
 * `workflow` is only meaningful when `route === "workflow"`. For `fallback`
 * routes, `workflow_type` at the storage layer is the sentinel `"fallback"`.
 */
export interface RouterOutput {
  routeKind: RouterRouteKind;
  route: RouterRoute;
  workflow?: Exclude<WorkflowType, "unclassified">;
  entities: ExtractedEntities;
  slots: Record<string, RouterSlot>;
  preference_updates: RouterPreferenceUpdate[];
  missing_required: string[];
  tool_bundles: ToolBundleName[];
  diagnostics: RouterDiagnostic[];
  reasoning: string;
}

/** Context passed into the router on each turn. */
export interface RouterInputContext {
  /** Raw user text from `pi.on("input")`. */
  text: string;
  /** Last 5 user/assistant turns (most recent last). */
  priorTurns: Array<{ role: "user" | "assistant"; text: string }>;
  /** Current investor_profile snapshot retrieved from preferences storage. */
  profileSnapshot: Record<string, unknown>;
  /** Last 3 workflow_runs, compact summaries. */
  recentWorkflowRuns: Array<{
    workflowType: string;
    turnType: string;
    resolvedSlots?: Record<string, unknown>;
    createdAt: string;
  }>;
}

/**
 * Abstract LLM client used by the router. Injected by callers so unit tests
 * can supply a deterministic mock. The real implementation (see
 * `src/routing/router-llm-client.ts`) wraps pi-ai's `completeSimple`.
 */
export interface RouterLlmClient {
  /**
   * Run a single prompt → text completion. Router parses the returned text
   * as JSON; the client is not responsible for structured-output parsing.
   */
  complete(prompt: string): Promise<string>;
}
