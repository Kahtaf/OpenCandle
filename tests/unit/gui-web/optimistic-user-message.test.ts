import { describe, expect, it } from "vitest";
import { createOptimisticUserMessageEvents } from "../../../gui/web/src/features/chat/optimistic-user-message.js";
import { compactDuplicateUserMessages, eventsToLiveEntries } from "../../../gui/web/src/features/chat/live-entries.js";

describe("optimistic GUI user messages", () => {
  it("renders the submitted user prompt before any server run events arrive", () => {
    const entries = eventsToLiveEntries(createOptimisticUserMessageEvents("What is AAPL trading at?"));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "message",
      message: {
        role: "user",
        content: [{ type: "text", text: "What is AAPL trading at?" }],
      },
    });
  });

  it("keeps one user bubble when the persisted server message arrives after the optimistic one", () => {
    const optimistic = eventsToLiveEntries(createOptimisticUserMessageEvents("Compare MSFT and GOOGL"));
    const persisted = {
      type: "message",
      id: "persisted-user",
      message: {
        role: "user",
        content: [{ type: "text", text: "Compare MSFT and GOOGL" }],
      },
    };

    expect(compactDuplicateUserMessages([...optimistic, persisted])).toHaveLength(1);
    expect(compactDuplicateUserMessages([persisted, ...optimistic])).toHaveLength(1);
  });
});
