// Remembers that the user dismissed the first-run onboarding dialog.
//
// The dialog auto-opens while model setup is required. Without a durable
// record, every fresh mount of the chat panel counts as a first run, so a new
// chat, a route change, a reload, or a second tab reopens a dialog the user
// already closed. The record is per browser profile, which is the same scope as
// the local GUI and the hosted PWA share for their other browser-local state.
//
// It is cleared as soon as setup is satisfied, so a later regression back to
// "needs setup" (keys cleared) still earns one automatic opening.
export const FIRST_RUN_SETUP_DISMISSED_KEY = "opencandle.onboarding.first-run-dismissed.v1";

function dismissalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Reading localStorage throws when the browser blocks storage for this
    // origin. Onboarding must still work, it just cannot remember anything.
    return null;
  }
}

export function readFirstRunSetupDismissed() {
  try {
    return dismissalStorage()?.getItem(FIRST_RUN_SETUP_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeFirstRunSetupDismissed(dismissed) {
  const storage = dismissalStorage();
  if (!storage) return;
  try {
    if (dismissed) storage.setItem(FIRST_RUN_SETUP_DISMISSED_KEY, "true");
    else storage.removeItem(FIRST_RUN_SETUP_DISMISSED_KEY);
  } catch {
    // A full or blocked store must never break model setup.
  }
}
