// Per-turn accumulator for soft-tier provider degradations. When a soft
// provider falls back to a keyless alternative (e.g. Brave → DuckDuckGo, Exa →
// keyless MCP, Finnhub → cached/free source), the tool result content carries
// a `[OPENCANDLE_SOFT_DEGRADED ...]` tag. The extension's `tool_result` hook
// records the provider id in this accumulator WITHOUT mutating the tool
// result; at `turn_end` the accumulator builds a single combined
// `[OPENCANDLE_SKIPPED ...]`-style annotation that gets appended to the
// session as a sidecar entry for observability.
//
// Per-provider state (never_ask / snoozed / completed) lives in the persistent
// OnboardingState on disk — the accumulator stays pure and consults the
// caller-supplied state snapshot at `buildCombinedAnnotation` time. This keeps
// the accumulator trivially testable without mocking the filesystem.

import type { ProviderId } from "./providers.js";
import { getProvider } from "./providers.js";
import type { OnboardingState } from "./state.js";
import { buildSkippedTag } from "./tool-tags.js";

export interface DegradationAccumulator {
  /** Record that a soft-tier provider fell back during this turn. Idempotent. */
  record(provider: ProviderId): void;
  /** Number of distinct providers recorded since the last reset. */
  size(): number;
  /** True when nothing has been recorded since the last reset. */
  isEmpty(): boolean;
  /**
   * Build a newline-delimited list of `[OPENCANDLE_SKIPPED ...]` tags — one
   * per distinct recorded provider. Providers whose `state.providers[id]`
   * entry has `status: "never_ask"` get the `(silenced)` suffix in their
   * remediation so the system prompt instruction suppresses the `/connect`
   * link in the final answer. Returns `null` when no providers are recorded.
   */
  buildCombinedAnnotation(state: OnboardingState): string | null;
  /** Clear all recorded providers. Call this at turn_start. */
  reset(): void;
}

export function createDegradationAccumulator(): DegradationAccumulator {
  const recorded = new Set<ProviderId>();

  return {
    record(provider: ProviderId): void {
      recorded.add(provider);
    },
    size(): number {
      return recorded.size;
    },
    isEmpty(): boolean {
      return recorded.size === 0;
    },
    buildCombinedAnnotation(state: OnboardingState): string | null {
      if (recorded.size === 0) return null;
      const lines: string[] = [];
      for (const provider of recorded) {
        const descriptor = getProvider(provider);
        const entry = state.providers[provider];
        const silenced = entry?.status === "never_ask";
        const alias = descriptor.aliases[0] ?? descriptor.id;
        const baseRemediation = `run /connect ${alias} to unlock`;
        const remediation = silenced ? `${baseRemediation} (silenced)` : baseRemediation;
        lines.push(
          buildSkippedTag({
            provider,
            reason: "credential_not_provided",
            remediation,
            silenced: silenced || undefined,
          }),
        );
      }
      return lines.join("\n");
    },
    reset(): void {
      recorded.clear();
    },
  };
}
