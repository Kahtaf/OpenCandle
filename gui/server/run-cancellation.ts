/**
 * Per-session registry of GUI chat runs that can be explicitly cancelled.
 *
 * The browser Stop button targets the original chat run's action id, so a stale
 * Stop (from an older run) can never retire a newer run: `cancel` only fires
 * when the target action id matches the run currently registered for that
 * session. Registration happens before session creation so an early Stop is
 * remembered and applied as soon as the run can accept cancellation.
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

export function createGuiRunRegistry(): GuiRunRegistry {
  const runs = new Map<string, RunRecord>();

  return {
    start({ sessionId, actionId }) {
      // Refuse to replace an active run: a concurrent second request must not
      // overwrite the original run's cancellation tracking.
      if (runs.has(sessionId)) return null;
      const record: RunRecord = {
        cancelRequested: false,
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
      if (!record) return { cancelled: false, reason: "no_active_run" };
      if (record.handle.actionId !== targetActionId) {
        return { cancelled: false, reason: "stale_target" };
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
