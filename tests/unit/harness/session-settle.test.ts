import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { promptAndWaitForCompletion, type SettleTarget } from "../../harness/session-settle.js";

function idleTarget(): SettleTarget {
  return {
    session: {
      subscribe: (_listener: (event: AgentSessionEvent) => void) => () => {},
      prompt: async () => {},
      isIdle: true,
      pendingMessageCount: 0,
    },
    waitForSettled: async () => {},
  };
}

describe("promptAndWaitForCompletion", () => {
  it("completes after the full quiet window when it fits inside the timeout", async () => {
    const started = Date.now();
    const outcome = await promptAndWaitForCompletion(idleTarget(), "hi", {
      timeoutMs: 2_000,
      resolveSettleMs: () => 100,
    });
    expect(outcome).toEqual({ status: "complete" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(95);
  });

  it("reports incomplete instead of shortening the quiet window at the deadline", async () => {
    const outcome = await promptAndWaitForCompletion(idleTarget(), "hi", {
      timeoutMs: 150,
      resolveSettleMs: () => 1_000,
    });
    expect(outcome).toMatchObject({ status: "incomplete", reason: "session_busy", timeoutMs: 150 });
  });

  describe("timer cleanup", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("clears a pending quiet-window timer when the deadline wins", async () => {
      const realSetTimeout = globalThis.setTimeout;
      const realClearTimeout = globalThis.clearTimeout;
      const pending = new Map<unknown, number>();
      vi.spyOn(globalThis, "setTimeout").mockImplementation(((
        handler: () => void,
        ms?: number,
        ...args: unknown[]
      ) => {
        const handle = realSetTimeout(
          () => {
            pending.delete(handle);
            handler();
          },
          ms,
          ...args,
        );
        pending.set(handle, ms ?? 0);
        return handle;
      }) as typeof setTimeout);
      vi.spyOn(globalThis, "clearTimeout").mockImplementation(((handle: unknown) => {
        pending.delete(handle);
        realClearTimeout(handle as ReturnType<typeof setTimeout>);
      }) as typeof clearTimeout);

      const outcome = await promptAndWaitForCompletion(idleTarget(), "hi", {
        timeoutMs: 50,
        resolveSettleMs: () => 60_000,
      });

      expect(outcome).toMatchObject({ status: "incomplete" });
      const leaked = [...pending.values()].filter((ms) => ms >= 1_000);
      for (const handle of pending.keys())
        realClearTimeout(handle as ReturnType<typeof setTimeout>);
      expect(leaked).toEqual([]);
    });
  });
});
