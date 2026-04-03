import type { ProviderResult } from "./evidence.js";

/**
 * Tracks provider failures within a workflow run and short-circuits
 * calls to providers that have exceeded the failure threshold.
 */
export class ProviderTracker {
  private readonly failures = new Map<string, number>();

  constructor(private readonly maxFailures: number = 2) {}

  /** Record a failure for a provider. */
  recordFailure(provider: string): void {
    this.failures.set(provider, (this.failures.get(provider) ?? 0) + 1);
  }

  /** Check whether a provider's circuit is open (too many failures). */
  isCircuitOpen(provider: string): boolean {
    return (this.failures.get(provider) ?? 0) >= this.maxFailures;
  }

  /** Get a short-circuit unavailable result for a provider. */
  shortCircuit<T>(provider: string): ProviderResult<T> {
    return {
      status: "unavailable",
      reason: "provider_circuit_open",
      provider,
    };
  }

  /** Reset failure count for a provider. */
  reset(provider: string): void {
    this.failures.delete(provider);
  }

  /** Reset all tracked failures. */
  resetAll(): void {
    this.failures.clear();
  }
}
