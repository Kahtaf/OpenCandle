/**
 * Per-session registry of GUI chat runs that can be explicitly cancelled.
 *
 * The browser Stop button targets the original chat run's action id, so a stale
 * Stop (from an older run) can never retire a newer run: `cancel` only fires
 * when the target action id matches the run currently registered for that
 * session. Registration happens before session creation so an early Stop is
 * remembered and applied as soon as the run can accept cancellation, and a Stop
 * that arrives before its run is registered at all is remembered briefly by
 * target action id so that run starts already cancelled.
 */
import type { SessionCancellationToken } from "../../src/pi/session-cancellation.js";

export type GuiRunCancelResult =
  | { cancelled: false; reason: "no_active_run" | "stale_target" }
  | { cancelled: true; duplicate: boolean };

export interface GuiRunHandle {
  readonly sessionId: string;
  readonly actionId: string;
  readonly cancelRequested: boolean;
  /**
   * Provide the cancellation callback once the run's session exists. If a Stop
   * already landed, the callback fires immediately.
   */
  setApplyCancel(apply: () => void): void;
}

export interface GuiRunRegistry {
  /**
   * Register a run for a session. Returns null when the session already has an
   * active run: admission is atomic here so a second concurrent start can
   * never overwrite the original run's cancellation tracking, even while the
   * busy-set guard has not yet been set.
   */
  start(input: { sessionId: string; actionId: string }): GuiRunHandle | null;
  finish(handle: GuiRunHandle): void;
  has(sessionId: string): boolean;
  cancel(sessionId: string, targetActionId: string): GuiRunCancelResult;
}

interface RunRecord {
  handle: GuiRunHandle;
  applyCancel?: () => void;
  cancelRequested: boolean;
}

export interface GuiRunRegistryOptions {
  now?: () => number;
  /** How long a Stop for a not-yet-registered run is remembered. */
  earlyCancelRetentionMs?: number;
  /** Upper bound on remembered early Stops; the oldest is forgotten first. */
  maxEarlyCancels?: number;
}

const DEFAULT_EARLY_CANCEL_RETENTION_MS = 2 * 60 * 1000;
const MAX_EARLY_CANCELS = 256;

export function createGuiRunRegistry(options: GuiRunRegistryOptions = {}): GuiRunRegistry {
  const now = options.now ?? Date.now;
  const earlyCancelRetentionMs =
    options.earlyCancelRetentionMs ?? DEFAULT_EARLY_CANCEL_RETENTION_MS;
  const maxEarlyCancels = options.maxEarlyCancels ?? MAX_EARLY_CANCELS;
  const runs = new Map<string, RunRecord>();
  // A Stop can overtake its own run request (the run body is still being read
  // or its session resolved), so the target is not registered yet. Remember
  // the exact session + original action id briefly; if that run is admitted
  // later it starts already cancelled and never dispatches its prompt.
  const earlyCancels = new Map<string, number>();
  const earlyCancelKey = (sessionId: string, actionId: string) =>
    JSON.stringify([sessionId, actionId]);
  const pruneEarlyCancels = () => {
    const currentTime = now();
    for (const [key, expiresAt] of earlyCancels) {
      if (expiresAt <= currentTime) earlyCancels.delete(key);
    }
  };
  const rememberEarlyCancel = (sessionId: string, actionId: string) => {
    pruneEarlyCancels();
    const key = earlyCancelKey(sessionId, actionId);
    earlyCancels.delete(key);
    earlyCancels.set(key, now() + earlyCancelRetentionMs);
    for (const oldest of earlyCancels.keys()) {
      if (earlyCancels.size <= maxEarlyCancels) break;
      earlyCancels.delete(oldest);
    }
  };
  const takeEarlyCancel = (sessionId: string, actionId: string): boolean => {
    pruneEarlyCancels();
    return earlyCancels.delete(earlyCancelKey(sessionId, actionId));
  };

  return {
    start({ sessionId, actionId }) {
      // Refuse to replace an active run: a concurrent second request must not
      // overwrite the original run's cancellation tracking.
      if (runs.has(sessionId)) return null;
      const record: RunRecord = {
        cancelRequested: takeEarlyCancel(sessionId, actionId),
        handle: {
          sessionId,
          actionId,
          get cancelRequested() {
            return record.cancelRequested;
          },
          setApplyCancel(apply) {
            record.applyCancel = apply;
            if (record.cancelRequested) apply();
          },
        },
      };
      runs.set(sessionId, record);
      return record.handle;
    },

    finish(handle) {
      if (runs.get(handle.sessionId)?.handle === handle) {
        runs.delete(handle.sessionId);
      }
    },

    has(sessionId) {
      return runs.has(sessionId);
    },

    cancel(sessionId, targetActionId) {
      const record = runs.get(sessionId);
      if (!record || record.handle.actionId !== targetActionId) {
        // Nothing to cancel right now, but the target run may still be on its
        // way: remember it so a late admission starts already stopped.
        rememberEarlyCancel(sessionId, targetActionId);
        return record
          ? { cancelled: false, reason: "stale_target" }
          : { cancelled: false, reason: "no_active_run" };
      }
      if (record.cancelRequested) return { cancelled: true, duplicate: true };
      record.cancelRequested = true;
      record.applyCancel?.();
      return { cancelled: true, duplicate: false };
    },
  };
}

export interface GuiRunCancellationTargets {
  token: SessionCancellationToken | null;
  coordinator?: { cancelActiveWorkflow(): void } | null;
  session?: {
    abort?: () => Promise<void>;
    clearQueue?: () => { steering: string[]; followUp: string[] };
  } | null;
}

/**
 * Retire a stopped run: mark the input-hook token cancelled (covers Stop while
 * the router await is in flight, before any Pi agent run exists), retire the
 * active workflow, drop any queued workflow follow-up prompts, and abort an
 * already-active model/tool operation. Every target is optional so a
 * partially-constructed run still cancels cleanly.
 */
export function applyGuiRunCancellation(targets: GuiRunCancellationTargets): void {
  targets.token?.cancel();
  targets.coordinator?.cancelActiveWorkflow();
  targets.session?.clearQueue?.();
  void Promise.resolve(targets.session?.abort?.()).catch(() => {});
}
