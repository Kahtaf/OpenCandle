import { describe, expect, it, vi } from "vitest";
import { createAskUserBridge } from "../../../gui/server/ask-user-bridge.js";

describe("GUI ask_user bridge", () => {
  it("broadcasts a pending prompt and resolves with the browser answer", async () => {
    const broadcast = vi.fn();
    const bridge = createAskUserBridge({ broadcast, getSessionId: () => "session-1" });

    const pending = bridge.ask({
      question: "Which ticker?",
      questionType: "text",
      placeholder: "e.g. AAPL",
      reason: "Need a symbol before fetching data.",
    });

    const prompt = bridge.getPrompts()[0];
    expect(prompt).toMatchObject({
      question: "Which ticker?",
      questionType: "text",
      placeholder: "e.g. AAPL",
      reason: "Need a symbol before fetching data.",
      sessionId: "session-1",
      status: "pending",
    });
    expect(broadcast).toHaveBeenCalledWith({ type: "ask_user.prompt", prompt });

    expect(bridge.answer(prompt.id, "AAPL")).toBe(true);
    await expect(pending).resolves.toEqual({ answer: "AAPL", cancelled: false });
    expect(bridge.getPrompts()[0]).toMatchObject({
      id: prompt.id,
      status: "answered",
      answer: "AAPL",
    });
    expect(broadcast).toHaveBeenLastCalledWith({
      type: "ask_user.resolved",
      prompt: expect.objectContaining({ id: prompt.id, status: "answered", answer: "AAPL" }),
    });
  });

  it("cancels a pending prompt", async () => {
    const bridge = createAskUserBridge({ broadcast: vi.fn(), getSessionId: () => "session-1" });
    const pending = bridge.ask({ question: "Proceed?", questionType: "confirm" });
    const prompt = bridge.getPrompts()[0];

    expect(bridge.cancel(prompt.id)).toBe(true);

    await expect(pending).resolves.toEqual({ answer: null, cancelled: true });
    expect(bridge.getPrompts()[0]).toMatchObject({
      id: prompt.id,
      status: "cancelled",
      answer: null,
    });
  });

  it("captures the active session for each prompt", () => {
    let sessionId = "session-1";
    const bridge = createAskUserBridge({
      broadcast: vi.fn(),
      getSessionId: () => sessionId,
    });

    void bridge.ask({ question: "First?", questionType: "text" });
    sessionId = "session-2";
    void bridge.ask({ question: "Second?", questionType: "text" });

    expect(bridge.getPrompts().map((prompt) => prompt.sessionId)).toEqual([
      "session-1",
      "session-2",
    ]);
  });

  it("can stamp prompts for an explicit route-addressed session", () => {
    const bridge = createAskUserBridge({
      broadcast: vi.fn(),
      getSessionId: () => "active-session",
    });

    void bridge.askForSession("target-session")({ question: "Continue?", questionType: "text" });

    expect(bridge.getPrompts()[0]).toMatchObject({
      question: "Continue?",
      sessionId: "target-session",
      status: "pending",
    });
  });
});

describe("GUI ask_user bridge run cancellation", () => {
  it("cancels only the stopped session's pending prompts", async () => {
    const broadcast = vi.fn();
    const bridge = createAskUserBridge({ broadcast, getSessionId: () => "session-1" });
    const stopped = bridge.askForSession("session-1")({ question: "A?", questionType: "text" });
    const other = bridge.askForSession("session-2")({ question: "B?", questionType: "text" });

    expect(bridge.cancelForSession("session-1")).toBe(1);

    await expect(stopped).resolves.toEqual({ answer: null, cancelled: true });
    const [first, second] = bridge.getPrompts();
    expect(first).toMatchObject({ sessionId: "session-1", status: "cancelled" });
    expect(second).toMatchObject({ sessionId: "session-2", status: "pending" });
    expect(broadcast).toHaveBeenLastCalledWith({
      type: "ask_user.resolved",
      prompt: expect.objectContaining({ id: first?.id, status: "cancelled" }),
    });
    // A late answer to the stopped question is rejected.
    expect(bridge.answer(first?.id ?? "", "late")).toBe(false);
    expect(bridge.cancelForSession("session-1")).toBe(0);

    bridge.cancel(second?.id ?? "");
    await other;
  });

  it("settles a pending prompt as cancelled when the run signal aborts", async () => {
    const bridge = createAskUserBridge({ broadcast: vi.fn(), getSessionId: () => "session-1" });
    const controller = new AbortController();
    const pending = bridge.ask(
      { question: "Proceed?", questionType: "confirm" },
      { signal: controller.signal },
    );

    controller.abort();

    await expect(pending).resolves.toEqual({ answer: null, cancelled: true });
    expect(bridge.getPrompts()[0]).toMatchObject({ status: "cancelled" });
  });

  it("never opens a prompt for a run that was already stopped", async () => {
    const broadcast = vi.fn();
    const bridge = createAskUserBridge({ broadcast, getSessionId: () => "session-1" });
    const controller = new AbortController();
    controller.abort();

    await expect(
      bridge.ask({ question: "Proceed?", questionType: "confirm" }, { signal: controller.signal }),
    ).resolves.toEqual({ answer: null, cancelled: true });
    expect(bridge.getPrompts()).toEqual([]);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
