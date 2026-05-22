import { describe, expect, it } from "vitest";
import {
  waitForEntryCount,
  waitForNewEntryId,
  waitForSessionTurnSettlement,
} from "../../../gui/server/session-entry-wait.js";

describe("waitForEntryCount", () => {
  it("waits until the entry count advances past the previous count", async () => {
    let count = 1;
    setTimeout(() => {
      count = 2;
    }, 5);

    await waitForEntryCount(() => count, 1, { timeoutMs: 100, intervalMs: 1 });

    expect(count).toBe(2);
  });

  it("throws after the timeout when no new entries arrive", async () => {
    await expect(waitForEntryCount(() => 1, 1, { timeoutMs: 10, intervalMs: 1 }))
      .rejects.toThrow("Timed out waiting for a new session entry");
  });

  it("waits for a new entry id even when the total entry count is unchanged", async () => {
    let ids = ["old-entry"];
    setTimeout(() => {
      ids = ["new-entry"];
    }, 5);

    await waitForNewEntryId(() => ids, new Set(["old-entry"]), { timeoutMs: 100, intervalMs: 1 });

    expect(ids).toEqual(["new-entry"]);
  });

  it("throws after the timeout when no new entry id arrives", async () => {
    await expect(waitForNewEntryId(() => ["old-entry"], new Set(["old-entry"]), { timeoutMs: 10, intervalMs: 1 }))
      .rejects.toThrow("Timed out waiting for a new session entry");
  });
});

describe("waitForSessionTurnSettlement", () => {
  it("waits through an async workflow-dispatched turn before returning", async () => {
    let isStreaming = false;
    setTimeout(() => {
      isStreaming = true;
    }, 5);
    setTimeout(() => {
      isStreaming = false;
    }, 20);

    const started = Date.now();
    await waitForSessionTurnSettlement(
      () => ({ isStreaming, pendingMessageCount: 0 }),
      { timeoutMs: 100, intervalMs: 1, idleGraceMs: 10 },
    );

    expect(Date.now() - started).toBeGreaterThanOrEqual(28);
  });

  it("waits until queued follow-ups clear and the session remains idle", async () => {
    let pendingMessageCount = 1;
    setTimeout(() => {
      pendingMessageCount = 0;
    }, 5);

    await waitForSessionTurnSettlement(
      () => ({ isStreaming: false, pendingMessageCount }),
      { timeoutMs: 100, intervalMs: 1, idleGraceMs: 5 },
    );

    expect(pendingMessageCount).toBe(0);
  });

  it("throws after the timeout when the session remains active", async () => {
    await expect(waitForSessionTurnSettlement(
      () => ({ isStreaming: true, pendingMessageCount: 0 }),
      { timeoutMs: 10, intervalMs: 1, idleGraceMs: 5 },
    )).rejects.toThrow("Timed out waiting for the session turn to settle");
  });
});
