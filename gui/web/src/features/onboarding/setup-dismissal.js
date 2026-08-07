// Remembers that the first-run onboarding dialog has already been shown in this
// browser profile.
//
// The dialog is a first-run introduction, not a recurring prompt. It auto-opens
// exactly once per browser profile, so it must be able to tell a genuine first
// time apart from every later visit. Without a durable record, a new chat, a
// route change, a reload, or a second tab each look like a first run, and a
// reload lands on a real non-ready requirement for a frame before stored keys
// resolve, which flashes the dialog open and closed again.
//
// The record is written the moment the dialog opens, so reading it and
// navigating away counts as having seen it. Once it exists the dialog never
// auto-opens again, including after keys are cleared: setup stays reachable
// from the composer's model control and from Settings. Hosted "clear all"
// removes the record along with the rest of the browser state, which is what
// makes a wiped profile a first-timer again.
export const FIRST_RUN_ONBOARDING_SEEN_KEY = "opencandle.onboarding.first-run-seen.v1";

// Earlier builds stored a dismissal under this key. A profile that dismissed
// onboarding then has seen it, so the record migrates forward on first read
// rather than treating an upgraded browser as a first-timer. Hosted clear all
// removes it alongside the seen record, otherwise migration would resurrect
// a wiped profile's seen state.
export const LEGACY_FIRST_RUN_DISMISSED_KEY = "opencandle.onboarding.first-run-dismissed.v1";

function onboardingStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Reading localStorage throws when the browser blocks storage for this
    // origin. Onboarding must still work, it just cannot remember anything.
    return null;
  }
}

export function readFirstRunOnboardingSeen() {
  try {
    const storage = onboardingStorage();
    if (!storage) return false;
    if (storage.getItem(FIRST_RUN_ONBOARDING_SEEN_KEY) === "true") return true;
    if (storage.getItem(LEGACY_FIRST_RUN_DISMISSED_KEY) === "true") {
      storage.setItem(FIRST_RUN_ONBOARDING_SEEN_KEY, "true");
      storage.removeItem(LEGACY_FIRST_RUN_DISMISSED_KEY);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function markFirstRunOnboardingSeen() {
  const storage = onboardingStorage();
  if (!storage) return;
  try {
    storage.setItem(FIRST_RUN_ONBOARDING_SEEN_KEY, "true");
  } catch {
    // A full or blocked store must never break model setup.
  }
}
