/**
 * Shared "is this prompt finished?" signal for every harness entry point.
 *
 * A prompt is complete only when OpenCandle's own settle signal holds
 * (`createOpenCandleSession().waitForSettled()`: the active workflow, including
 * every queued step prompt, is terminal and the Pi session is idle), Pi has no
 * pending steering/follow-up messages, and the session stays that way for a
 * quiet window. A fixed grace after the first `agent_end` is not enough: a
 * multi-step workflow sends its next step only after the previous one settles,
 * and a slow first token on that step looks exactly like "done".
 */

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export interface SettleSession {
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string): Promise<void>;
  readonly isIdle?: boolean;
  readonly pendingMessageCount?: number;
}

export interface SettleTarget {
  session: SettleSession;
  /** OpenCandle's workflow + session settle signal. */
  waitForSettled?: () => Promise<void>;
  coordinator?: { getActiveWorkflowType(): string | undefined };
}

export type SettleOutcome =
  | { status: "complete" }
  | {
      status: "incomplete";
      /** A workflow was still running, or the plain session was still busy. */
      reason: "workflow_running" | "session_busy";
      workflow?: string;
      timeoutMs: number;
    };

export interface SettleOptions {
  timeoutMs: number;
  /**
   * Quiet window after the completion signal holds. Any session event during
   * it restarts the wait. Resolved at each check so callers can widen it once
   * the turn has dispatched a workflow.
   */
  resolveSettleMs: () => number;
}

const TIMED_OUT = Symbol("timed-out");
const POLL_MS = 50;

export async function promptAndWaitForCompletion(
  target: SettleTarget,
  prompt: string,
  options: SettleOptions,
): Promise<SettleOutcome> {
  const { session } = target;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<typeof TIMED_OUT>((resolve) => {
    deadlineTimer = setTimeout(() => resolve(TIMED_OUT), options.timeoutMs);
  });
  const withDeadline = <T>(promise: Promise<T>) => Promise.race([promise, timedOut]);
  // A sleep that loses the race to the deadline clears its own timer so it
  // never keeps the event loop alive after this function returns.
  const sleep = async (ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await withDeadline(
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, Math.max(0, ms));
        }),
      );
    } finally {
      clearTimeout(timer);
    }
  };

  let activity = 0;
  const unsubscribe = session.subscribe(() => {
    activity += 1;
  });

  const incomplete = (): SettleOutcome => {
    const workflow = target.coordinator?.getActiveWorkflowType();
    return {
      status: "incomplete",
      reason: workflow ? "workflow_running" : "session_busy",
      ...(workflow ? { workflow } : {}),
      timeoutMs: options.timeoutMs,
    };
  };
  // A workflow between steps can leave Pi idle with no events while it decides
  // on the next step prompt; only a signal that resolves right away counts.
  const settledNow = async () => {
    if (!target.waitForSettled) return true;
    const probe = target.waitForSettled().then(() => true);
    probe.catch(() => {});
    return Promise.race([
      probe,
      new Promise<boolean>((resolve) => setImmediate(() => resolve(false))),
    ]);
  };
  const busy = () => session.isIdle === false || (session.pendingMessageCount ?? 0) > 0;

  try {
    const promptRun = session.prompt(prompt);
    // A late rejection after a timeout must not surface as unhandled.
    promptRun.catch(() => {});
    if ((await withDeadline(promptRun)) === TIMED_OUT) return incomplete();

    for (;;) {
      if (target.waitForSettled && (await withDeadline(target.waitForSettled())) === TIMED_OUT) {
        return incomplete();
      }
      if (busy()) {
        if ((await sleep(POLL_MS)) === TIMED_OUT) return incomplete();
        continue;
      }
      const activityBefore = activity;
      // The full quiet window must elapse inside the deadline; a window cut
      // short by the timeout never counts as complete.
      if ((await sleep(options.resolveSettleMs())) === TIMED_OUT) return incomplete();
      if (activity === activityBefore && !busy() && (await settledNow())) {
        return { status: "complete" };
      }
    }
  } finally {
    clearTimeout(deadlineTimer);
    unsubscribe();
  }
}
