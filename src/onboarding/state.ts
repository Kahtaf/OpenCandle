// Onboarding state schema and pure helpers.
//
// Shape: one flag for the welcome message (`welcomeShownAt`) plus a partial
// per-provider map with a proper discriminated union for status + snooze.
//
// All transition helpers are PURE — they return a new state object rather
// than mutating. The caller is responsible for persisting via saveOnboardingState.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureParentDir, getOnboardingPath } from "../infra/opencandle-paths.js";
import type { ProviderId } from "./providers.js";

export const ONBOARDING_VERSION = 2;

export type ProviderOnboardingEntry =
  | { status: "completed"; lastPromptAt: string }
  | { status: "snoozed"; lastPromptAt: string; snoozeUntil: string }
  | { status: "never_ask"; lastPromptAt: string };

export interface OnboardingState {
  version: number;
  /** ISO 8601 timestamp the welcome message was first seeded, or undefined if never. */
  welcomeShownAt?: string;
  providers: Partial<Record<ProviderId, ProviderOnboardingEntry>>;
}

export function getDefaultOnboardingState(): OnboardingState {
  return { version: ONBOARDING_VERSION, providers: {} };
}

// -----------------------------------------------------------------------------
// Load / save
// -----------------------------------------------------------------------------

const STATUS_VALUES: ReadonlySet<string> = new Set(["completed", "snoozed", "never_ask"]);

function parseEntry(raw: unknown): ProviderOnboardingEntry | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const status = obj.status;
  if (typeof status !== "string" || !STATUS_VALUES.has(status)) return undefined;
  const lastPromptAt = obj.lastPromptAt;
  if (typeof lastPromptAt !== "string") return undefined;

  if (status === "snoozed") {
    const snoozeUntil = obj.snoozeUntil;
    if (typeof snoozeUntil !== "string") return undefined;
    return { status: "snoozed", lastPromptAt, snoozeUntil };
  }
  if (status === "completed") {
    return { status: "completed", lastPromptAt };
  }
  return { status: "never_ask", lastPromptAt };
}

function parseProvidersMap(raw: unknown): Partial<Record<ProviderId, ProviderOnboardingEntry>> {
  if (!raw || typeof raw !== "object") return {};
  const result: Partial<Record<ProviderId, ProviderOnboardingEntry>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = parseEntry(value);
    if (entry) result[key as ProviderId] = entry;
  }
  return result;
}

export function loadOnboardingState(path = getOnboardingPath()): OnboardingState {
  if (!existsSync(path)) {
    return getDefaultOnboardingState();
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return getDefaultOnboardingState();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return getDefaultOnboardingState();
  }

  if (!parsed || typeof parsed !== "object") {
    return getDefaultOnboardingState();
  }

  const obj = parsed as Record<string, unknown>;
  const version = typeof obj.version === "number" ? obj.version : ONBOARDING_VERSION;
  const welcomeShownAt = typeof obj.welcomeShownAt === "string" ? obj.welcomeShownAt : undefined;
  const providers = parseProvidersMap(obj.providers);

  return { version, welcomeShownAt, providers };
}

export function saveOnboardingState(state: OnboardingState, path = getOnboardingPath()): void {
  ensureParentDir(path);
  // Strip undefined fields for cleaner on-disk output.
  const serializable: Record<string, unknown> = {
    version: state.version,
    providers: state.providers,
  };
  if (state.welcomeShownAt !== undefined) {
    serializable.welcomeShownAt = state.welcomeShownAt;
  }
  writeFileSync(path, `${JSON.stringify(serializable, null, 2)}\n`, "utf-8");
}

// -----------------------------------------------------------------------------
// Pure transitions
// -----------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

export function markProviderCompleted(state: OnboardingState, id: ProviderId): OnboardingState {
  return {
    ...state,
    providers: {
      ...state.providers,
      [id]: { status: "completed", lastPromptAt: nowIso() },
    },
  };
}

export function markProviderSnoozed(
  state: OnboardingState,
  id: ProviderId,
  days: number,
): OnboardingState {
  const now = new Date();
  const snoozeUntil = new Date(now.getTime() + days * 24 * 3600 * 1000);
  return {
    ...state,
    providers: {
      ...state.providers,
      [id]: {
        status: "snoozed",
        lastPromptAt: now.toISOString(),
        snoozeUntil: snoozeUntil.toISOString(),
      },
    },
  };
}

export function markProviderNeverAsk(state: OnboardingState, id: ProviderId): OnboardingState {
  return {
    ...state,
    providers: {
      ...state.providers,
      [id]: { status: "never_ask", lastPromptAt: nowIso() },
    },
  };
}

export function clearProviderOnboardingEntry(
  state: OnboardingState,
  id: ProviderId,
): OnboardingState {
  const providers = { ...state.providers };
  delete providers[id];
  return { ...state, providers };
}

export function markWelcomeShown(state: OnboardingState): OnboardingState {
  return { ...state, welcomeShownAt: nowIso() };
}

// -----------------------------------------------------------------------------
// Pure queries
// -----------------------------------------------------------------------------

export function getProviderEntry(
  state: OnboardingState,
  id: ProviderId,
): ProviderOnboardingEntry | undefined {
  return state.providers[id];
}

export interface ShouldPromptOptions {
  /**
   * When true, treats a `completed` entry as eligible for re-prompt. This is
   * how stale credentials (401 after a previously-connected key) get a fresh
   * offer.
   */
  stale?: boolean;
}

export function shouldPrompt(
  state: OnboardingState,
  id: ProviderId,
  now: Date,
  options: ShouldPromptOptions = {},
): boolean {
  const entry = state.providers[id];
  if (!entry) return true;

  switch (entry.status) {
    case "never_ask":
      return false;
    case "completed":
      return options.stale === true;
    case "snoozed": {
      const until = Date.parse(entry.snoozeUntil);
      if (Number.isNaN(until)) return true;
      return now.getTime() >= until;
    }
  }
}

export function shouldShowWelcome(state: OnboardingState, hasUI: boolean): boolean {
  if (!hasUI) return false;
  return state.welcomeShownAt === undefined;
}
