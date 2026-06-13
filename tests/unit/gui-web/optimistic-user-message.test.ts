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
      content: [{ type: "text", text: "What is AAPL trading at?" }],
    });
  });

  it("keeps one user bubble when the persisted server message arrives after the optimistic one", () => {
    const optimistic = createOptimisticUserMessageEvents("Compare MSFT and GOOGL");
    const persisted = persistedUserEvents("persisted-user", "Compare MSFT and GOOGL");

    expect(chatRowsFromEvents(persisted, optimistic)).toHaveLength(1);
    expect(chatRowsFromEvents(optimistic, persisted)).toHaveLength(1);
  });
});

function persistedUserEvents(messageId: string, text: string) {
  return [
    { type: "message.created" as const, messageId, role: "user" as const, seq: 1 },
    {
      type: "message.completed" as const,
      messageId,
      content: [{ type: "text" as const, text }],
      seq: 2,
    },
  ];
}
