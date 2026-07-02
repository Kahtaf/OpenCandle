import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createLocalSessionCoordinator,
  type SessionActionEnvelope,
} from "../../../gui/server/local-session-coordinator.js";

describe("local session coordinator", () => {
  it("applies a session action once when a retry reuses the same action id", async () => {
    const coordinator = createLocalSessionCoordinator();
    const handler = vi.fn(async () => ({ accepted: true }));
    const action = chatAction({ actionId: "action-1" });

    const first = await coordinator.runSessionAction(action, handler);
    const retry = await coordinator.runSessionAction(action, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ ok: true, duplicate: false, result: { accepted: true } });
    expect(retry).toEqual({ ok: true, duplicate: true, result: { accepted: true } });
  });

  it("treats a deliberate repeat with a fresh action id as a new user intent", async () => {
    const coordinator = createLocalSessionCoordinator();
    const handler = vi.fn(async () => ({ accepted: true }));

    await coordinator.runSessionAction(chatAction({ actionId: "action-1" }), handler);
    await coordinator.runSessionAction(chatAction({ actionId: "action-2" }), handler);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("does not dedupe a session action whose handler rejects before admission", async () => {
    const coordinator = createLocalSessionCoordinator();
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error("not admitted"))
      .mockResolvedValueOnce({ accepted: true });
    const action = chatAction({ actionId: "action-1" });

    await expect(coordinator.runSessionAction(action, handler)).rejects.toThrow("not admitted");
    await expect(coordinator.runSessionAction(action, handler)).resolves.toEqual({
      ok: true,
      duplicate: false,
      result: { accepted: true },
    });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("routes failed chat admission through a non-deduping sentinel", () => {
    const source = readHttpRouteSource();

    expect(source).toContain("if (!admitted) throw new SessionActionNotAdmitted();");
  });

  it("returns a neutral busy result for a second active run action instead of queueing", async () => {
    const coordinator = createLocalSessionCoordinator();
    let finishFirst!: () => void;
    const firstRun = coordinator.runSessionAction(
      chatAction({ actionId: "action-1" }),
      () =>
        new Promise((resolve) => {
          finishFirst = () => resolve({ accepted: true });
        }),
    );

    const secondRun = await coordinator.runSessionAction(
      chatAction({ actionId: "action-2" }),
      async () => ({ accepted: true }),
    );

    expect(secondRun).toEqual({
      ok: false,
      code: "session_busy",
      message: "OpenCandle is still working in this session. Try again when it finishes.",
    });
    finishFirst();
    await expect(firstRun).resolves.toMatchObject({ ok: true, duplicate: false });
  });

  it("allows independent sessions to run concurrently", async () => {
    const coordinator = createLocalSessionCoordinator();
    const seen: string[] = [];

    await Promise.all([
      coordinator.runSessionAction(chatAction({ sessionId: "session-a" }), async (action) => {
        seen.push(action.sessionId);
        return { accepted: true };
      }),
      coordinator.runSessionAction(chatAction({ sessionId: "session-b" }), async (action) => {
        seen.push(action.sessionId);
        return { accepted: true };
      }),
    ]);

    expect(seen.sort()).toEqual(["session-a", "session-b"]);
  });

  it("expires dedupe records after the retention horizon", async () => {
    let now = 1_000;
    const coordinator = createLocalSessionCoordinator({
      now: () => now,
      dedupeRetentionMs: 100,
    });
    const handler = vi.fn(async () => ({ accepted: true }));
    const action = chatAction({ actionId: "action-1" });

    await coordinator.runSessionAction(action, handler);
    now = 1_200;
    await coordinator.runSessionAction(action, handler);

    expect(handler).toHaveBeenCalledTimes(2);
  });
});

function chatAction(overrides: Partial<SessionActionEnvelope> = {}): SessionActionEnvelope {
  return {
    sessionId: "session-1",
    actionId: "action-1",
    actionType: "chat.prompt",
    payload: { prompt: "Tell me about AAPL" },
    source: "gui",
    ...overrides,
  };
}

function readHttpRouteSource(): string {
  return readFileSync("gui/server/http-routes.ts", "utf8");
}
