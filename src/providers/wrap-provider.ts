import type { ProviderResult } from "../runtime/evidence.js";
import { getProviderTracker } from "../runtime/run-context.js";
import { cache } from "../infra/cache.js";

/**
 * Wrap a provider function call so that thrown exceptions are caught
 * and returned as a structured `ProviderResultUnavailable`.
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
