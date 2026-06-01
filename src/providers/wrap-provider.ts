import type { ProviderResult } from "../runtime/evidence.js";
import { getProviderTracker } from "../runtime/run-context.js";
import { cache } from "../infra/cache.js";
import { InvalidSymbolError } from "./errors.js";
import { ProviderCredentialError } from "./provider-credential-error.js";

/**
 * Wrap a provider function call so that thrown exceptions are caught
 * and returned as a structured `ProviderResultUnavailable`.
 *
 * `ProviderCredentialError` is the one exception: it is re-thrown
 * unchanged so the tool layer can catch it and emit a tagged
 * `[OPENCANDLE_CREDENTIAL_REQUIRED ...]` tool-result content block
 * (see `src/onboarding/tool-tags.ts`). Swallowing credential errors
 * into `unavailable` would hide the just-in-time setup offer from
 * the `tool_result` interception handler.
 *
 * When a run context is active, checks circuit breaker state before
 * calling and records failures after.
 *
 * After a successful provider call, checks if the cache's stale flag
 * was set (meaning the provider fell back to stale cached data internally)
 * and propagates that metadata on the result.
 */
export async function wrapProvider<T>(
  providerId: string,
  fn: () => Promise<T>,
): Promise<ProviderResult<T>> {
  const tracker = getProviderTracker();

  if (tracker?.isCircuitOpen(providerId)) {
    return {
      status: "unavailable",
      reason: "provider_circuit_open",
      provider: providerId,
    };
  }

  try {
    const data = await fn();
    const { stale, cachedAt } = cache.consumeStaleFlag();
    return {
      status: "ok",
      data,
      timestamp: stale ? new Date(cachedAt).toISOString() : new Date().toISOString(),
      stale: stale || undefined,
    };
  } catch (error) {
    // Credential errors are re-thrown so the tool-layer `withCredentialCheck`
    // helper can convert them into LLM-visible tagged content. Do NOT record
    // these as tracker failures — they are a user-config problem, not a
    // provider reliability problem.
    if (error instanceof ProviderCredentialError) {
      throw error;
    }
    if (error instanceof InvalidSymbolError) {
      return {
        status: "unavailable",
        reason: error.message,
        provider: providerId,
      };
    }
    tracker?.recordFailure(providerId);
    const reason =
      error instanceof Error ? error.message : "unknown_error";
    return {
      status: "unavailable",
      reason,
      provider: providerId,
    };
  }
}
