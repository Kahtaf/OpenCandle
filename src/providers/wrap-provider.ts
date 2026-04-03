import type { ProviderResult } from "../runtime/evidence.js";

/**
 * Wrap a provider function call so that thrown exceptions are caught
 * and returned as a structured `ProviderResultUnavailable`.
 */
export async function wrapProvider<T>(
  providerName: string,
  fn: () => Promise<T>,
): Promise<ProviderResult<T>> {
  try {
    const data = await fn();
    return {
      status: "ok",
      data,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "unknown_error";
    return {
      status: "unavailable",
      reason,
      provider: providerName,
    };
  }
}
