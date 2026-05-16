import { describe, expect, it, vi } from "vitest";
import { createAskUserBridge } from "../../../gui/server/ask-user-bridge.js";

describe("GUI ask_user bridge", () => {
  it("broadcasts a pending prompt and resolves with the browser answer", async () => {
    const broadcast = vi.fn();
    const bridge = createAskUserBridge({ broadcast });

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
      status: "pending",
    });
    expect(broadcast).toHaveBeenCalledWith({ type: "ask_user.prompt", prompt });

    expect(bridge.answer(prompt.id, "AAPL")).toBe(true);
    await expect(pending).resolves.toEqual({ answer: "AAPL", cancelled: false });
    expect(bridge.getPrompts()[0]).toMatchObject({ id: prompt.id, status: "answered", answer: "AAPL" });
    expect(broadcast).toHaveBeenLastCalledWith({
      type: "ask_user.resolved",
      prompt: expect.objectContaining({ id: prompt.id, status: "answered", answer: "AAPL" }),
    });
  });

  it("cancels a pending prompt", async () => {
    const bridge = createAskUserBridge({ broadcast: vi.fn() });
    const pending = bridge.ask({ question: "Proceed?", questionType: "confirm" });
    const prompt = bridge.getPrompts()[0];

    expect(bridge.cancel(prompt.id)).toBe(true);

    await expect(pending).resolves.toEqual({ answer: null, cancelled: true });
    expect(bridge.getPrompts()[0]).toMatchObject({ id: prompt.id, status: "cancelled", answer: null });
  });
});
