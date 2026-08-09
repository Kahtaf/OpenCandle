import type { StateDatabase } from "../runtime/state-database.js";
import { MemoryStorage, type StoredPreference } from "./storage.js";
import { listAllToolDefaults, type StoredToolDefault } from "./tool-defaults.js";

/**
 * The read model behind Settings -> Preferences.
 *
 * It carries exactly the two silently written stores and nothing else: model
 * and provider credentials live in Pi auth storage and the onboarding state
 * file, never in these tables, so no filtering is needed to keep secrets out.
 */
export interface PreferencesSnapshot {
  preferences: StoredPreference[];
  toolDefaults: StoredToolDefault[];
}

export function buildPreferencesSnapshot(db: StateDatabase): PreferencesSnapshot {
  return {
    preferences: new MemoryStorage(db).listAllPreferences(),
    toolDefaults: listAllToolDefaults(db),
  };
}
