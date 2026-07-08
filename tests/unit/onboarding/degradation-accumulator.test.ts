import { describe, expect, it } from "vitest";
import { createDegradationAccumulator } from "../../../src/onboarding/degradation-accumulator.js";
import type { OnboardingState } from "../../../src/onboarding/state.js";
import { parseToolTag } from "../../../src/onboarding/tool-tags.js";

function emptyState(): OnboardingState {
  return { version: 2, providers: {} };
}

describe("createDegradationAccumulator", () => {
  it("starts empty and reports isEmpty=true", () => {
    const acc = createDegradationAccumulator();
    expect(acc.isEmpty()).toBe(true);
    expect(acc.size()).toBe(0);
    expect(acc.buildCombinedAnnotation(emptyState())).toBeNull();
  });

  it("records a single soft-tier provider and builds a one-line skipped annotation", () => {
    const acc = createDegradationAccumulator();
    acc.record("brave");
    expect(acc.isEmpty()).toBe(false);
    expect(acc.size()).toBe(1);

    const annotation = acc.buildCombinedAnnotation(emptyState());
    expect(annotation).not.toBeNull();
    expect(annotation).toContain("[OPENCANDLE_SKIPPED");
    expect(annotation).toContain("provider=brave");

    const parsed = parseToolTag(annotation!);
    expect(parsed?.kind).toBe("skipped");
    if (parsed?.kind === "skipped") {
      expect(parsed.provider).toBe("brave");
      expect(parsed.remediation).toContain("/connect");
      expect(parsed.silenced).toBeUndefined();
    }
  });

  it("deduplicates repeat records of the same provider", () => {
    const acc = createDegradationAccumulator();
    acc.record("brave");
    acc.record("brave");
    acc.record("brave");
    expect(acc.size()).toBe(1);
  });

  it("builds one skipped tag per distinct recorded provider", () => {
    const acc = createDegradationAccumulator();
    acc.record("brave");
    acc.record("exa");
    acc.record("finnhub");

    const annotation = acc.buildCombinedAnnotation(emptyState());
    expect(annotation).not.toBeNull();
    const lines = annotation?.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);

    const providers = new Set<string>();
    for (const line of lines) {
      const parsed = parseToolTag(line);
      expect(parsed?.kind).toBe("skipped");
      if (parsed?.kind === "skipped") providers.add(parsed.provider);
    }
    expect(providers).toEqual(new Set(["brave", "exa", "finnhub"]));
  });

  it("marks silenced=true in the emitted tag when the provider is never_ask", () => {
    // 11.3 — when state.providers[id].status === "never_ask", the emitted
    // remediation string must contain `(silenced)` so the system-prompt
    // instruction suppresses the `/connect` link in the final answer.
    const acc = createDegradationAccumulator();
    acc.record("finnhub");

    const state: OnboardingState = {
      version: 2,
      providers: {
        finnhub: {
          status: "never_ask",
          lastPromptAt: "2026-04-01T00:00:00.000Z",
        },
      },
    };

    const annotation = acc.buildCombinedAnnotation(state);
    expect(annotation).not.toBeNull();
    expect(annotation).toContain("(silenced)");

    const parsed = parseToolTag(annotation!);
    expect(parsed?.kind).toBe("skipped");
    if (parsed?.kind === "skipped") {
      expect(parsed.silenced).toBe(true);
      expect(parsed.remediation).toContain("(silenced)");
    }
  });

  it("non-never_ask providers get a normal remediation even when mixed with never_ask ones", () => {
    const acc = createDegradationAccumulator();
    acc.record("brave");
    acc.record("finnhub");

    const state: OnboardingState = {
      version: 2,
      providers: {
        finnhub: {
          status: "never_ask",
          lastPromptAt: "2026-04-01T00:00:00.000Z",
        },
      },
    };

    const annotation = acc.buildCombinedAnnotation(state);
    expect(annotation).not.toBeNull();
    const lines = annotation?.split("\n").filter((l) => l.length > 0);
    const parsedByProvider = new Map<string, ReturnType<typeof parseToolTag>>();
    for (const line of lines) {
      const parsed = parseToolTag(line);
      if (parsed?.kind === "skipped") parsedByProvider.set(parsed.provider, parsed);
    }

    const finnhub = parsedByProvider.get("finnhub");
    const brave = parsedByProvider.get("brave");
    expect(finnhub?.kind).toBe("skipped");
    expect(brave?.kind).toBe("skipped");
    if (finnhub?.kind === "skipped") expect(finnhub.silenced).toBe(true);
    if (brave?.kind === "skipped") {
      expect(brave.silenced).toBeUndefined();
      expect(brave.remediation).not.toContain("(silenced)");
    }
  });

  it("reset() clears all recorded providers", () => {
    const acc = createDegradationAccumulator();
    acc.record("brave");
    acc.record("exa");
    acc.reset();
    expect(acc.isEmpty()).toBe(true);
    expect(acc.buildCombinedAnnotation(emptyState())).toBeNull();
  });
});
