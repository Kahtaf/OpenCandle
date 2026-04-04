import type { ProviderResult } from "../runtime/evidence.js";
import { wrapProvider } from "./wrap-provider.js";
import { getProviderTracker } from "../runtime/run-context.js";

export interface FallbackEntry<T> {
  provider: string;
  fn: () => Promise<T>;
}

/**
 * Try providers in order, stopping at the first success.
 * Skips circuit-open providers. Each provider call goes through wrapProvider
 * (circuit check + failure recording + stale flag propagation).
 *
 * Stale cache fallback is NOT managed here — it happens inside each
 * provider function (Level B). By the time a provider throws to wrapProvider,
 * it already tried its own stale cache.
 */
export async function withFallback<T>(
  entries: FallbackEntry<T>[],
): Promise<ProviderResult<T>> {
  const tracker = getProviderTracker();
  const attempted: string[] = [];

  for (const entry of entries) {
    if (tracker?.isCircuitOpen(entry.provider)) continue;
    attempted.push(entry.provider);

    const result = await wrapProvider(entry.provider, entry.fn);
    if (result.status === "ok") return result;
    // wrapProvider already called recordFailure on the tracker
  }

  return {
    status: "unavailable",
    reason: attempted.length > 0
      ? `all providers failed: ${attempted.join(", ")}`
      : `all providers circuit-open: ${entries.map((e) => e.provider).join(", ")}`,
    provider: entries[0]?.provider ?? "unknown",
  };
}
