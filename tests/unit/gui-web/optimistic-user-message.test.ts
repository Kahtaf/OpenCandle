import { describe, expect, it } from "vitest";
import { chatRowsFromEvents } from "../../../gui/web/src/features/chat/chat-rows.js";
import { createOptimisticUserMessageEvents } from "../../../gui/web/src/features/chat/optimistic-user-message.js";

describe("optimistic GUI user messages", () => {
  it("renders the submitted user prompt before any server run events arrive", () => {
    const rows = chatRowsFromEvents(
      [],
      createOptimisticUserMessageEvents("What is AAPL trading at?"),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "user_message",
      delivery: "queued",
      content: [{ type: "text", text: "What is AAPL trading at?" }],
    });
  });

  it("scopes optimistic events to the target session", () => {
    expect(createOptimisticUserMessageEvents("hello", "session-a")).toEqual([
      expect.objectContaining({ type: "message.created", sessionId: "session-a" }),
      expect.objectContaining({ type: "message.completed", sessionId: "session-a" }),
    ]);
  });

  it("keeps the session id on rendered rows for route-scoped UI state", () => {
    const rows = chatRowsFromEvents(
      [],
      createOptimisticUserMessageEvents("What is AAPL trading at?", "session-a"),
      "session-a",
    );

    expect(rows[0]).toMatchObject({
      type: "user_message",
      sessionId: "session-a",
    });
  });

  it("keeps one user bubble when the persisted server message arrives after the optimistic one", () => {
    const optimistic = createOptimisticUserMessageEvents("Compare MSFT and GOOGL");
    const persisted = persistedUserEvents("persisted-user", "Compare MSFT and GOOGL");

    expect(chatRowsFromEvents(persisted, optimistic)).toHaveLength(1);
    expect(chatRowsFromEvents(persisted, optimistic)[0]).toMatchObject({ delivery: "sent" });
    expect(chatRowsFromEvents(optimistic, persisted)).toHaveLength(1);
    expect(chatRowsFromEvents(optimistic, persisted)[0]).toMatchObject({ delivery: "sent" });
  });

  it("deduplicates attachment sends once the persisted server message arrives", () => {
    const attachments = [{ kind: "image", label: "chart.png" }];
    const optimistic = createOptimisticUserMessageEvents("is this bearish?", "session-a", {
      attachments,
    });
    const persisted = persistedUserEvents("persisted-user", "is this bearish?", attachments);

    const rows = chatRowsFromEvents(optimistic, persisted);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ attachments });
  });

  it("keeps repeated user prompts when their attachments differ", () => {
    const first = persistedUserEvents("first-user", "is this bullish or bearish?", [
      { kind: "image", label: "image/png #1" },
    ]);
    const second = persistedUserEvents(
      "second-user",
      "is this bullish or bearish?",
      [{ kind: "image", label: "image/png #2" }],
      3,
    );

    const rows = chatRowsFromEvents([...first, ...second]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ attachments: [{ kind: "image", label: "image/png #1" }] });
    expect(rows[1]).toMatchObject({ attachments: [{ kind: "image", label: "image/png #2" }] });
  });
});

function persistedUserEvents(
  messageId: string,
  text: string,
  attachments?: unknown[],
  seqStart = 1,
) {
  return [
    { type: "message.created" as const, messageId, role: "user" as const, seq: seqStart },
    {
      type: "message.completed" as const,
      messageId,
      content: [{ type: "text" as const, text }],
      ...(attachments ? { attachments } : {}),
      seq: seqStart + 1,
    },
  ];
}
