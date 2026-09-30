import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
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
});
