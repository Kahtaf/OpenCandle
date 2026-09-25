import { describe, expect, it, vi } from "vitest";
import {
  applyGuiRunCancellation,
  createGuiRunRegistry,
} from "../../../gui/server/run-cancellation.js";
import { createSessionCancellationToken } from "../../../src/pi/session-cancellation.js";

describe("GUI active run cancellation registry", () => {
  it("tracks the active run per session and clears it on finish", () => {
    const registry = createGuiRunRegistry();
    const run = registry.start({ sessionId: "session-1", actionId: "chat-1" })!;

    expect(registry.has("session-1")).toBe(true);
    registry.finish(run);
    expect(registry.has("session-1")).toBe(false);
  });

  it("cancels the run whose original action id matches the stop target", () => {
    const registry = createGuiRunRegistry();
    const applyCancel = vi.fn();
    const run = registry.start({ sessionId: "session-1", actionId: "chat-1" })!;
    run.setApplyCancel(applyCancel);

    expect(registry.cancel("session-1", "chat-1")).toEqual({ cancelled: true, duplicate: false });
    expect(applyCancel).toHaveBeenCalledOnce();
  });

  it("treats a repeated stop for the same run as an idempotent duplicate", () => {
    const registry = createGuiRunRegistry();
    const applyCancel = vi.fn();
    const run = registry.start({ sessionId: "session-1", actionId: "chat-1" })!;
    run.setApplyCancel(applyCancel);

    expect(registry.cancel("session-1", "chat-1")).toEqual({ cancelled: true, duplicate: false });
    expect(registry.cancel("session-1", "chat-1")).toEqual({ cancelled: true, duplicate: true });
    expect(applyCancel).toHaveBeenCalledOnce();
  });

  it("never cancels a newer run from a stale stop that names an older action id", () => {
    const registry = createGuiRunRegistry();
    const applyCancel = vi.fn();
    const run = registry.start({ sessionId: "session-1", actionId: "chat-new" })!;
    run.setApplyCancel(applyCancel);

    expect(registry.cancel("session-1", "chat-old")).toEqual({
      cancelled: false,
      reason: "stale_target",
    });
    expect(applyCancel).not.toHaveBeenCalled();
    expect(run.cancelRequested).toBe(false);
  });

  it("reports no active run instead of throwing for an idle session", () => {
    const registry = createGuiRunRegistry();

    expect(registry.cancel("session-1", "chat-1")).toEqual({
      cancelled: false,
      reason: "no_active_run",
    });
  });

  it("remembers a stop that lands before its run is registered and applies it on admission", () => {
    const registry = createGuiRunRegistry();
    // The Stop request can overtake its own run request (the run body is still
    // being read or its session resolved). It must not be lost.
    expect(registry.cancel("session-1", "chat-1")).toEqual({
      cancelled: false,
      reason: "no_active_run",
    });
    const applyCancel = vi.fn();
    const run = registry.start({ sessionId: "session-1", actionId: "chat-1" })!;
    expect(run.cancelRequested).toBe(true);
    run.setApplyCancel(applyCancel);
    expect(applyCancel).toHaveBeenCalledOnce();
  });

  it("does not apply a remembered early stop to a run with a different action id", () => {
    const registry = createGuiRunRegistry();
    registry.cancel("session-1", "chat-old");
    const run = registry.start({ sessionId: "session-1", actionId: "chat-new" })!;
    expect(run.cancelRequested).toBe(false);
    registry.finish(run);
    expect(registry.start({ sessionId: "session-2", actionId: "chat-old" })!.cancelRequested).toBe(
      false,
    );
  });

  it("remembers an early stop that lands while a different run is still active", () => {
    const registry = createGuiRunRegistry();
    const other = registry.start({ sessionId: "session-1", actionId: "chat-other" })!;
    expect(registry.cancel("session-1", "chat-1")).toEqual({
      cancelled: false,
      reason: "stale_target",
    });
    expect(other.cancelRequested).toBe(false);
    registry.finish(other);
    expect(registry.start({ sessionId: "session-1", actionId: "chat-1" })!.cancelRequested).toBe(
      true,
    );
  });

  it("bounds remembered early stops by forgetting the oldest first", () => {
    const registry = createGuiRunRegistry({ maxEarlyCancels: 2 });
    registry.cancel("session-1", "chat-1");
    registry.cancel("session-2", "chat-2");
    registry.cancel("session-1", "chat-1");
    registry.cancel("session-3", "chat-3");
    expect(registry.start({ sessionId: "session-2", actionId: "chat-2" })!.cancelRequested).toBe(
      false,
    );
    expect(registry.start({ sessionId: "session-1", actionId: "chat-1" })!.cancelRequested).toBe(
      true,
    );
    expect(registry.start({ sessionId: "session-3", actionId: "chat-3" })!.cancelRequested).toBe(
      true,
    );
  });

  it("forgets a remembered early stop after its retention window", () => {
    let now = 1_000;
    const registry = createGuiRunRegistry({ now: () => now, earlyCancelRetentionMs: 5_000 });
    registry.cancel("session-1", "chat-1");
    now += 5_001;
    expect(registry.start({ sessionId: "session-1", actionId: "chat-1" })!.cancelRequested).toBe(
      false,
    );
  });

  it("applies an early stop that lands before the run is able to accept cancellation", () => {
    const registry = createGuiRunRegistry();
    const applyCancel = vi.fn();
    const run = registry.start({ sessionId: "session-1", actionId: "chat-1" })!;

    expect(registry.cancel("session-1", "chat-1")).toEqual({ cancelled: true, duplicate: false });
    expect(applyCancel).not.toHaveBeenCalled();
    expect(run.cancelRequested).toBe(true);

    run.setApplyCancel(applyCancel);
    expect(applyCancel).toHaveBeenCalledOnce();
  });

  it("keeps sessions isolated and does not let a stale finish clear a newer run", () => {
    const registry = createGuiRunRegistry();
    const first = registry.start({ sessionId: "session-1", actionId: "chat-1" })!;
    const other = registry.start({ sessionId: "session-2", actionId: "chat-2" })!;

    expect(registry.cancel("session-2", "chat-1")).toEqual({
      cancelled: false,
      reason: "stale_target",
    });

    registry.finish(other);
    expect(registry.has("session-2")).toBe(false);
    expect(registry.has("session-1")).toBe(true);

    // The first run finishes, a new one starts, and the old handle's finish
    // must not clear the newer run.
    registry.finish(first);
    const replacement = registry.start({ sessionId: "session-1", actionId: "chat-3" })!;
    registry.finish(first);
    expect(registry.has("session-1")).toBe(true);
    expect(registry.cancel("session-1", "chat-3").cancelled).toBe(true);
    registry.finish(replacement);
  });

  it("refuses a second concurrent start instead of overwriting the original run", () => {
    const registry = createGuiRunRegistry();
    const first = registry.start({ sessionId: "session-1", actionId: "chat-1" })!;

    // This is the race window before activeRunSessionIds is set: the second
    // request must be rejected, not silently replace the first run's tracking.
    const second = registry.start({ sessionId: "session-1", actionId: "chat-2" });
    expect(second).toBeNull();
    expect(registry.has("session-1")).toBe(true);

    const applyCancel = vi.fn();
    first.setApplyCancel(applyCancel);
    expect(registry.cancel("session-1", "chat-1")).toEqual({ cancelled: true, duplicate: false });
    expect(applyCancel).toHaveBeenCalledOnce();
    expect(registry.cancel("session-1", "chat-2")).toEqual({
      cancelled: false,
      reason: "stale_target",
    });
  });
});

describe("applyGuiRunCancellation", () => {
  it("cancels the input token, retires the workflow, and aborts the run", async () => {
    const token = createSessionCancellationToken();
    const cancelActiveWorkflow = vi.fn();
    const abort = vi.fn(async () => {});

    applyGuiRunCancellation({ token, coordinator: { cancelActiveWorkflow }, session: { abort } });

    expect(token.isCancelled()).toBe(true);
    expect(cancelActiveWorkflow).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(abort).toHaveBeenCalledOnce();
  });

  it("is safe when the run has no session or workflow yet", () => {
    const token = createSessionCancellationToken();
    expect(() => applyGuiRunCancellation({ token })).not.toThrow();
    expect(token.isCancelled()).toBe(true);
  });

  it("clears queued Pi prompts so a stopped workflow cannot run its next step", () => {
    const token = createSessionCancellationToken();
    const clearQueue = vi.fn(() => ({ steering: [], followUp: ["next workflow step"] }));

    applyGuiRunCancellation({ token, session: { abort: vi.fn(async () => {}), clearQueue } });

    expect(clearQueue).toHaveBeenCalledOnce();
  });

  it("cancels the stopped session's open ask_user questions so a waiting tool settles", async () => {
    const token = createSessionCancellationToken();
    const order: string[] = [];
    const abort = vi.fn(async () => {
      order.push("abort");
    });
    const cancelPendingQuestions = vi.fn(() => {
      order.push("questions");
    });

    applyGuiRunCancellation({ token, session: { abort }, cancelPendingQuestions });

    expect(cancelPendingQuestions).toHaveBeenCalledOnce();
    expect(order).toEqual(["abort", "questions"]);
  });
});
