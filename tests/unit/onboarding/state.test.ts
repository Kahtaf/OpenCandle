import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDefaultOnboardingState,
  getProviderEntry,
  loadOnboardingState,
  markProviderCompleted,
  markProviderNeverAsk,
  markProviderSnoozed,
  markWelcomeShown,
  ONBOARDING_VERSION,
  type OnboardingState,
  saveOnboardingState,
  shouldPrompt,
  shouldShowWelcome,
} from "../../../src/onboarding/state.js";

describe("onboarding state — defaults and persistence", () => {
  let tempDir: string;
  const originalOpenCandleHome = process.env.OPENCANDLE_HOME;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    if (originalOpenCandleHome == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalOpenCandleHome;
    }
  });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "opencandle-onboarding-"));
    process.env.OPENCANDLE_HOME = tempDir;
  });

  it("default state has version 2, empty providers map, and no welcomeShownAt", () => {
    const def = getDefaultOnboardingState();
    expect(def.version).toBe(2);
    expect(def.providers).toEqual({});
    expect(def.welcomeShownAt).toBeUndefined();
    expect(ONBOARDING_VERSION).toBe(2);
  });

  it("returns defaults when onboarding.json does not exist", () => {
    expect(loadOnboardingState()).toEqual(getDefaultOnboardingState());
  });

  it("persists onboarding.json under OPENCANDLE_HOME", () => {
    const state: OnboardingState = {
      version: 2,
      providers: { finnhub: { status: "never_ask", lastPromptAt: "2026-04-12T00:00:00.000Z" } },
    };
    saveOnboardingState(state);
    const reloaded = loadOnboardingState();
    expect(reloaded).toEqual(state);
    const raw = readFileSync(join(tempDir, "onboarding.json"), "utf-8");
    expect(raw).toContain("never_ask");
    expect(raw).toContain("finnhub");
  });

  it("ignores unknown fields in loaded state", () => {
    writeFileSync(
      join(tempDir, "onboarding.json"),
      JSON.stringify({
        version: 2,
        providers: {},
        mystery_field: "should be ignored",
      }),
      "utf-8",
    );
    const loaded = loadOnboardingState() as OnboardingState & { mystery_field?: unknown };
    expect(loaded.mystery_field).toBeUndefined();
    expect(loaded.version).toBe(2);
    expect(loaded.providers).toEqual({});
  });

  it("falls back to default state when the file is corrupt JSON", () => {
    writeFileSync(join(tempDir, "onboarding.json"), "{ this is not JSON", "utf-8");
    expect(() => loadOnboardingState()).not.toThrow();
    expect(loadOnboardingState()).toEqual(getDefaultOnboardingState());
  });

  it("partial presence in the providers map is legal", () => {
    const state: OnboardingState = {
      version: 2,
      providers: {
        alpha_vantage: { status: "completed", lastPromptAt: "2026-04-12T00:00:00.000Z" },
        // fred/finnhub/brave/exa are intentionally absent.
      },
    };
    saveOnboardingState(state);
    const reloaded = loadOnboardingState();
    expect(reloaded.providers.alpha_vantage?.status).toBe("completed");
    expect(reloaded.providers.fred).toBeUndefined();
  });
});

describe("onboarding state — provider transitions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("markProviderCompleted sets status completed with lastPromptAt, no snoozeUntil", () => {
    const state: OnboardingState = { version: 2, providers: {} };
    const updated = markProviderCompleted(state, "fred");
    const entry = updated.providers.fred;
    expect(entry?.status).toBe("completed");
    expect(entry?.lastPromptAt).toBe("2026-04-12T12:00:00.000Z");
    expect((entry as { snoozeUntil?: string }).snoozeUntil).toBeUndefined();
  });

  it("markProviderSnoozed sets status snoozed with snoozeUntil = lastPromptAt + days", () => {
    const state: OnboardingState = { version: 2, providers: {} };
    const updated = markProviderSnoozed(state, "finnhub", 7);
    const entry = updated.providers.finnhub;
    expect(entry?.status).toBe("snoozed");
    expect(entry?.lastPromptAt).toBe("2026-04-12T12:00:00.000Z");
    if (entry?.status === "snoozed") {
      expect(entry.snoozeUntil).toBe("2026-04-19T12:00:00.000Z");
    } else {
      throw new Error("expected snoozed entry");
    }
  });

  it("markProviderNeverAsk sets status never_ask with lastPromptAt and no snoozeUntil", () => {
    const state: OnboardingState = { version: 2, providers: {} };
    const updated = markProviderNeverAsk(state, "brave");
    const entry = updated.providers.brave;
    expect(entry?.status).toBe("never_ask");
    expect(entry?.lastPromptAt).toBe("2026-04-12T12:00:00.000Z");
  });

  it("markWelcomeShown sets welcomeShownAt to current ISO", () => {
    const state: OnboardingState = { version: 2, providers: {} };
    const updated = markWelcomeShown(state);
    expect(updated.welcomeShownAt).toBe("2026-04-12T12:00:00.000Z");
  });

  it("transitions are pure — original state is not mutated", () => {
    const state: OnboardingState = { version: 2, providers: {} };
    const updated = markProviderCompleted(state, "alpha_vantage");
    expect(state.providers.alpha_vantage).toBeUndefined();
    expect(updated.providers.alpha_vantage?.status).toBe("completed");
  });
});

describe("onboarding state — shouldPrompt / shouldShowWelcome", () => {
  const NOW = new Date("2026-04-12T12:00:00.000Z");

  it("shouldPrompt returns true when there is no provider entry", () => {
    const state: OnboardingState = { version: 2, providers: {} };
    expect(shouldPrompt(state, "alpha_vantage", NOW)).toBe(true);
  });

  it("shouldPrompt returns false when status is completed (and no stale flag)", () => {
    const state: OnboardingState = {
      version: 2,
      providers: { fred: { status: "completed", lastPromptAt: "2026-04-11T00:00:00.000Z" } },
    };
    expect(shouldPrompt(state, "fred", NOW)).toBe(false);
  });

  it("shouldPrompt returns true when completed AND stale flag is set", () => {
    const state: OnboardingState = {
      version: 2,
      providers: { fred: { status: "completed", lastPromptAt: "2026-04-11T00:00:00.000Z" } },
    };
    expect(shouldPrompt(state, "fred", NOW, { stale: true })).toBe(true);
  });

  it("shouldPrompt returns false when snoozed and snoozeUntil is in the future", () => {
    const state: OnboardingState = {
      version: 2,
      providers: {
        finnhub: {
          status: "snoozed",
          lastPromptAt: "2026-04-11T00:00:00.000Z",
          snoozeUntil: "2026-04-18T00:00:00.000Z",
        },
      },
    };
    expect(shouldPrompt(state, "finnhub", NOW)).toBe(false);
  });

  it("shouldPrompt returns true when snoozed and snoozeUntil is in the past", () => {
    const state: OnboardingState = {
      version: 2,
      providers: {
        finnhub: {
          status: "snoozed",
          lastPromptAt: "2026-04-01T00:00:00.000Z",
          snoozeUntil: "2026-04-08T00:00:00.000Z",
        },
      },
    };
    expect(shouldPrompt(state, "finnhub", NOW)).toBe(true);
  });

  it("shouldPrompt returns false when status is never_ask at any future time", () => {
    const state: OnboardingState = {
      version: 2,
      providers: { brave: { status: "never_ask", lastPromptAt: "2026-01-01T00:00:00.000Z" } },
    };
    expect(shouldPrompt(state, "brave", NOW)).toBe(false);
    expect(shouldPrompt(state, "brave", new Date("2099-01-01"))).toBe(false);
  });

  it("shouldShowWelcome is true only when hasUI AND welcomeShownAt is absent", () => {
    const fresh: OnboardingState = { version: 2, providers: {} };
    expect(shouldShowWelcome(fresh, true)).toBe(true);
    expect(shouldShowWelcome(fresh, false)).toBe(false);
    const seen: OnboardingState = {
      version: 2,
      providers: {},
      welcomeShownAt: "2026-04-12T00:00:00.000Z",
    };
    expect(shouldShowWelcome(seen, true)).toBe(false);
    expect(shouldShowWelcome(seen, false)).toBe(false);
  });

  it("getProviderEntry returns undefined for missing provider", () => {
    const state: OnboardingState = { version: 2, providers: {} };
    expect(getProviderEntry(state, "exa")).toBeUndefined();
  });

  it("getProviderEntry returns the entry when present", () => {
    const state: OnboardingState = {
      version: 2,
      providers: { exa: { status: "completed", lastPromptAt: "2026-04-12T00:00:00.000Z" } },
    };
    expect(getProviderEntry(state, "exa")?.status).toBe("completed");
  });
});
