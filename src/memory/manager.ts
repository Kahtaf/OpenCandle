import type { MemoryStorage } from "./storage.js";
import type { MemoryCategory, MemoryEntry } from "./types.js";
import {
  KEY_TO_CATEGORY,
  WORKFLOW_RELEVANT_CATEGORIES,
  NEVER_TRUST_FROM_MEMORY,
  isStale,
} from "./types.js";

/** Slot name → preference key(s) mapping for suppression. */
const SLOT_TO_PREF_KEYS: Record<string, string[]> = {
  riskProfile: ["risk_profile"],
  assetScope: ["asset_scope"],
  timeHorizon: ["time_horizon"],
  dteTarget: ["dte_target"],
  moneynessPreference: ["moneyness_preference"],
  liquidityMinimum: ["liquidity_minimum", "options_liquidity"],
};

const MAX_WORKFLOW_HISTORY_PER_TYPE = 3;
const MAX_PREFERENCE_LINES = 15;

/**
 * Selective, typed memory retrieval with staleness rules
 * and override suppression.
 */
export class MemoryManager {
  constructor(private readonly storage: MemoryStorage) {}

  /**
   * Retrieve memory entries relevant to the given workflow type,
   * filtering by category, staleness, and overrides.
   */
  retrieve(
    workflowType: string,
    overriddenSlots?: string[],
    now: Date = new Date(),
  ): MemoryEntry[] {
    const relevantCategories = WORKFLOW_RELEVANT_CATEGORIES[workflowType] ??
      WORKFLOW_RELEVANT_CATEGORIES["unclassified"];

    // Build set of preference keys to suppress
    const suppressedKeys = new Set<string>();
    if (overriddenSlots) {
      for (const slot of overriddenSlots) {
        const keys = SLOT_TO_PREF_KEYS[slot];
        if (keys) keys.forEach((k) => suppressedKeys.add(k));
      }
    }

    const entries: MemoryEntry[] = [];

    // Preferences as investor_profile entries
    if (relevantCategories.includes("investor_profile")) {
      const prefs = this.storage.getPreferencesByNamespace("global");
      for (const pref of prefs) {
        const key = String(pref.key);
        if (suppressedKeys.has(key)) continue;
        if (NEVER_TRUST_FROM_MEMORY.has(key)) continue;

        const category = KEY_TO_CATEGORY[key] ?? "investor_profile";
        if (!relevantCategories.includes(category)) continue;

        const entry: MemoryEntry = {
          key,
          value: tryParseValue(String(pref.value_json ?? "")),
          category,
          recordedAt: String(pref.updated_at ?? pref.created_at ?? now.toISOString()),
          confidence: pref.confidence != null ? String(pref.confidence) : undefined,
          source: pref.source != null ? String(pref.source) : undefined,
        };

        if (!isStale(entry, now)) {
          entries.push(entry);
        }
      }
    }

    // Workflow history
    if (relevantCategories.includes("workflow_history")) {
      const runs = this.storage.getRecentWorkflowRuns(MAX_WORKFLOW_HISTORY_PER_TYPE * 4);
      const countsByType = new Map<string, number>();

      for (const run of runs) {
        const wfType = String(run.workflow_type);
        const count = countsByType.get(wfType) ?? 0;
        if (count >= MAX_WORKFLOW_HISTORY_PER_TYPE) continue;
        countsByType.set(wfType, count + 1);

        const recordedAt = String(run.created_at ?? now.toISOString());
        const entry: MemoryEntry = {
          key: `workflow_run_${run.id}`,
          value: run.output_summary
            ? `${wfType}: ${run.output_summary}`
            : wfType,
          category: "workflow_history",
          recordedAt,
        };

        if (!isStale(entry, now)) {
          entries.push(entry);
        }
      }
    }

    return entries.slice(0, MAX_PREFERENCE_LINES + MAX_WORKFLOW_HISTORY_PER_TYPE * 4);
  }

  /**
   * Build compact text context from retrieved memory entries.
   */
  buildContext(
    workflowType: string,
    overriddenSlots?: string[],
    now: Date = new Date(),
  ): string {
    const entries = this.retrieve(workflowType, overriddenSlots, now);
    if (entries.length === 0) return "";

    const sections: string[] = [];

    // Group by category
    const byCategory = new Map<MemoryCategory, MemoryEntry[]>();
    for (const entry of entries) {
      const list = byCategory.get(entry.category) ?? [];
      list.push(entry);
      byCategory.set(entry.category, list);
    }

    const profileEntries = byCategory.get("investor_profile");
    if (profileEntries && profileEntries.length > 0) {
      const lines = profileEntries.map((e) => `- ${e.key}: ${e.value}`);
      sections.push("User Preferences:\n" + lines.join("\n"));
    }

    const historyEntries = byCategory.get("workflow_history");
    if (historyEntries && historyEntries.length > 0) {
      const lines = historyEntries.map((e) => `- ${e.value} (${e.recordedAt})`);
      sections.push("Recent Workflows:\n" + lines.join("\n"));
    }

    const feedbackEntries = byCategory.get("interaction_feedback");
    if (feedbackEntries && feedbackEntries.length > 0) {
      const lines = feedbackEntries.map((e) => `- ${e.key}: ${e.value}`);
      sections.push("Feedback:\n" + lines.join("\n"));
    }

    return sections.join("\n\n");
  }
}

function tryParseValue(json: string): string {
  try {
    const parsed = JSON.parse(json);
    return typeof parsed === "string" ? parsed : JSON.stringify(parsed);
  } catch {
    return json;
  }
}
