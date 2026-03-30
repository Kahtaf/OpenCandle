import type { MemoryStorage } from "./storage.js";

const MAX_PREFERENCE_LINES = 15;
const MAX_WORKFLOW_SUMMARY_LINES = 12;

/** Slot name → preference key(s) mapping for suppression. */
const SLOT_TO_PREF_KEYS: Record<string, string[]> = {
  riskProfile: ["risk_profile"],
  assetScope: ["asset_scope"],
  timeHorizon: ["time_horizon"],
  dteTarget: ["dte_target"],
  moneynessPreference: ["moneyness_preference"],
  liquidityMinimum: ["liquidity_minimum", "options_liquidity"],
};

/**
 * Build compact memory context for agent injection.
 * @param overriddenSlots Slot names whose values were overridden by current-turn user input.
 *   The corresponding preference keys will be excluded from memory context to avoid
 *   conflicting provenance signals.
 */
export function buildMemoryContext(
  storage: MemoryStorage,
  overriddenSlots?: string[],
): string {
  const sections: string[] = [];

  // Build set of preference keys to suppress
  const suppressedKeys = new Set<string>();
  if (overriddenSlots) {
    for (const slot of overriddenSlots) {
      const keys = SLOT_TO_PREF_KEYS[slot];
      if (keys) keys.forEach((k) => suppressedKeys.add(k));
    }
  }

  // Preferences
  const prefs = storage.getPreferencesByNamespace("global");
  if (prefs.length > 0) {
    const filtered = prefs.filter((p) => !suppressedKeys.has(String(p.key)));
    if (filtered.length > 0) {
      const lines = filtered.slice(0, MAX_PREFERENCE_LINES).map((p) => {
        const value = tryParseJson(p.value_json as string);
        return `- ${p.key}: ${value}`;
      });
      sections.push("User Preferences:\n" + lines.join("\n"));
    }
  }

  // Recent workflow runs
  const runs = storage.getRecentWorkflowRuns(3);
  if (runs.length > 0) {
    const lines = runs.slice(0, MAX_WORKFLOW_SUMMARY_LINES).map((r) => {
      const summary = r.output_summary ? ` — ${r.output_summary}` : "";
      return `- ${r.workflow_type} (${r.created_at})${summary}`;
    });
    sections.push("Recent Workflows:\n" + lines.join("\n"));
  }

  return sections.join("\n\n");
}

function tryParseJson(json: string): string {
  try {
    const parsed = JSON.parse(json);
    return typeof parsed === "string" ? parsed : JSON.stringify(parsed);
  } catch {
    return json;
  }
}
