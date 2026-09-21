import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findUnresolvedToolCalls,
  settleIdleGraceMsForPrompt,
  waitForEntryCount,
  waitForNewEntryId,
  waitForSessionTurnSettlement,
} from "../../../gui/server/session-entry-wait.js";

afterEach(() => {
  vi.useRealTimers();
});

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
    await expect(waitForEntryCount(() => 1, 1, { timeoutMs: 10, intervalMs: 1 })).rejects.toThrow(
      "Timed out waiting for a new session entry",
    );
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
    await expect(
      waitForNewEntryId(() => ["old-entry"], new Set(["old-entry"]), {
        timeoutMs: 10,
        intervalMs: 1,
      }),
    ).rejects.toThrow("Timed out waiting for a new session entry");
  });
});

describe("waitForSessionTurnSettlement", () => {
  it("waits through an async workflow-dispatched turn before returning", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    let isStreaming = false;
    let resolvedAt: number | undefined;
    setTimeout(() => {
      isStreaming = true;
    }, 5);
    setTimeout(() => {
      isStreaming = false;
    }, 20);

    const settled = waitForSessionTurnSettlement(() => ({ isStreaming, pendingMessageCount: 0 }), {
      timeoutMs: 100,
      intervalMs: 1,
      idleGraceMs: 10,
    }).then(() => {
      resolvedAt = Date.now();
    });

    await vi.advanceTimersByTimeAsync(29);
    expect(resolvedAt).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    await settled;

    expect(resolvedAt).toBe(30);
  });

  it("waits until queued follow-ups clear and the session remains idle", async () => {
    let pendingMessageCount = 1;
    setTimeout(() => {
      pendingMessageCount = 0;
    }, 5);

    await waitForSessionTurnSettlement(() => ({ isStreaming: false, pendingMessageCount }), {
      timeoutMs: 100,
      intervalMs: 1,
      idleGraceMs: 5,
    });

    expect(pendingMessageCount).toBe(0);
  });

  it("does not time out while the session keeps making progress past the stall window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    // A live /analyze run stays active far longer than any reasonable total
    // cap while its status keeps changing between steps; the timeout must
    // detect a stalled session (frozen status), not cap total runtime.
    let isStreaming = true;
    let pendingMessageCount = 0;
    for (let t = 8; t <= 48; t += 8) {
      setTimeout(() => {
        isStreaming = !isStreaming;
        pendingMessageCount = isStreaming ? 0 : 1;
      }, t);
    }
    setTimeout(() => {
      isStreaming = false;
      pendingMessageCount = 0;
    }, 56);

    let resolved = false;
    const settled = waitForSessionTurnSettlement(() => ({ isStreaming, pendingMessageCount }), {
      timeoutMs: 10,
      intervalMs: 1,
      idleGraceMs: 3,
    }).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(70);
    await settled;
    expect(resolved).toBe(true);
  });

  it("does not time out while a progress token keeps advancing during one long turn", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    // A single long model generation keeps isStreaming=true with no
    // pending-count changes; streamed session events are the only signal
    // that the turn is alive. The stall clock must reset on that signal.
    let isStreaming = true;
    let progressToken = 0;
    for (let t = 4; t <= 44; t += 4) {
      setTimeout(() => {
        progressToken += 1;
      }, t);
    }
    setTimeout(() => {
      isStreaming = false;
    }, 52);

    let resolved = false;
    const settled = waitForSessionTurnSettlement(
      () => ({ isStreaming, pendingMessageCount: 0, progressToken }),
      {
        timeoutMs: 10,
        intervalMs: 1,
        idleGraceMs: 3,
      },
    ).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(70);
    await settled;
    expect(resolved).toBe(true);
  });

  it("throws after the timeout when the session remains active", async () => {
    await expect(
      waitForSessionTurnSettlement(() => ({ isStreaming: true, pendingMessageCount: 0 }), {
        timeoutMs: 10,
        intervalMs: 1,
        idleGraceMs: 5,
      }),
    ).rejects.toThrow("Timed out waiting for the session turn to settle");
  });
});

describe("settleIdleGraceMsForPrompt", () => {
  // Regression coverage for the GUI/TUI parity gap: dispatching
  // comprehensive_analysis ("analyze NVDA") produced only its first-step
  // opencandle-workflow/user-input entries over the GUI chat-run endpoint,
  // missing every opencandle-analyst-step/disclaimer/validation/
  // workflow-event/workflow-complete entry the same prompt produces over
  // the TUI harness. The GUI's default idle grace (tuned for an ordinary
  // single-turn reply) elapsed in the gap between one workflow step's turn
  // going idle and the runner sending the next step's prompt, so the chat
  // run reported "complete" after only the first step.
  it("widens the grace for a comprehensive-analysis prompt, matching the TUI harness's settleGraceMsForTurn", () => {
    expect(settleIdleGraceMsForPrompt("analyze NVDA", [], new Set())).toBe(30_000);
    expect(settleIdleGraceMsForPrompt("full analysis of NVDA", [], new Set())).toBe(30_000);
    expect(settleIdleGraceMsForPrompt("deep dive on $NVDA", [], new Set())).toBe(30_000);
  });

  it("widens the grace when the session already shows a dispatched multi-step workflow", () => {
    const entries = [
      {
        id: "new-1",
        type: "custom",
        customType: "opencandle-workflow",
        data: { workflow: "portfolio_builder" },
      },
    ] as unknown[] as Parameters<typeof settleIdleGraceMsForPrompt>[1];
    expect(settleIdleGraceMsForPrompt("build me a portfolio", entries, new Set())).toBe(30_000);
  });

  it("does not widen the grace for a multi-step workflow entry from a previous prompt", () => {
    const entries = [
      {
        id: "old-1",
        type: "custom",
        customType: "opencandle-workflow",
        data: { workflow: "portfolio_builder" },
      },
    ] as unknown[] as Parameters<typeof settleIdleGraceMsForPrompt>[1];
    // Regression: a session that once ran portfolio_builder must not give
    // every later ordinary prompt the multi-step grace. The workflow entry
    // predates this prompt, so it says nothing about what this prompt
    // dispatches.
    expect(
      settleIdleGraceMsForPrompt("what is NVDA trading at?", entries, new Set(["old-1"])),
    ).toBeUndefined();
  });

  it("widens the grace for a multi-step workflow entry added by the current prompt", () => {
    const entries = [
      {
        id: "old-1",
        type: "custom",
        customType: "opencandle-workflow",
        data: { workflow: "portfolio_builder" },
      },
      {
        id: "new-1",
        type: "custom",
        customType: "opencandle-workflow",
        data: { workflow: "options_screener" },
      },
    ] as unknown[] as Parameters<typeof settleIdleGraceMsForPrompt>[1];
    expect(
      settleIdleGraceMsForPrompt("what is NVDA trading at?", entries, new Set(["old-1"])),
    ).toBe(30_000);
  });

  it("leaves the caller's default grace alone for an ordinary single-turn prompt", () => {
    expect(settleIdleGraceMsForPrompt("what is NVDA trading at?", [], new Set())).toBeUndefined();
  });

  it("does not widen the grace for a workflow type that settles in one turn", () => {
    const entries = [
      {
        id: "new-1",
        type: "custom",
        customType: "opencandle-workflow",
        data: { workflow: "comprehensive_analysis" },
      },
    ] as unknown[] as Parameters<typeof settleIdleGraceMsForPrompt>[1];
    // comprehensive_analysis is detected from the prompt text itself
    // (isAnalysisRequest), not from its own workflow-dispatch entry, so an
    // unrelated prompt sharing a session with one does not get widened.
    expect(
      settleIdleGraceMsForPrompt("what is NVDA trading at?", entries, new Set()),
    ).toBeUndefined();
  });
});

describe("findUnresolvedToolCalls", () => {
  it("reports tool calls from the latest assistant tool-use turn that have no result", () => {
    expect(
      findUnresolvedToolCalls([
        messageEntry("a1", {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "get_crypto_price",
              arguments: { id: "bitcoin" },
            },
          ],
          stopReason: "toolUse",
        }),
      ]),
    ).toEqual([
      {
        id: "call-1",
        name: "get_crypto_price",
      },
    ]);
  });

  it("does not report calls that have matching tool results", () => {
    expect(
      findUnresolvedToolCalls([
        messageEntry("a1", {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "get_crypto_price",
              arguments: { id: "bitcoin" },
            },
          ],
          stopReason: "toolUse",
        }),
        messageEntry("t1", {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "get_crypto_price",
          content: [{ type: "text", text: "BTC quote" }],
          isError: false,
        }),
      ]),
    ).toEqual([]);
  });

  it("reports OpenAI-style tool calls while their results are still pending", () => {
    expect(
      findUnresolvedToolCalls([
        messageEntry("a1", {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-openai-1",
              name: "get_stock_quote",
              arguments: { symbol: "NVDA" },
            },
          ],
          stopReason: "tool_calls",
        }),
      ]),
    ).toEqual([
      {
        id: "call-openai-1",
        name: "get_stock_quote",
      },
    ]);
  });
});

function messageEntry(id: string, message: unknown) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message,
  };
}
