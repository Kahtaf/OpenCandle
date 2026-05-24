import { classifyIntent } from "./classify-intent.js";
import type { ClassificationResult } from "./types.js";

/**
 * Explicit legacy deterministic router entrypoint.
 *
 * The LLM router is the default primary classifier. This wrapper names the
 * remaining deterministic use cases: `OPENCANDLE_ROUTER_MODE=rules` rollback
 * and narrow safety-net recovery/enrichment after LLM router validation.
 */
export function classifyWithLegacyRules(input: string): ClassificationResult {
  return classifyIntent(input);
}
