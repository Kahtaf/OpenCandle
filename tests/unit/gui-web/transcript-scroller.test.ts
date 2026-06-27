import { describe, expect, it } from "vitest";
import { pendingTranscriptAnchorId } from "../../../gui/web/src/features/chat/ChatPanel.jsx";

describe("transcript scroller anchoring", () => {
  it("does not anchor a new latest user row after reader intent freezes scrolling", () => {
    expect(
      pendingTranscriptAnchorId({
        latestUserChanged: true,
        latestUserRowId: "message-user-2",
        following: false,
      }),
    ).toBe("");
  });

  it("keeps explicit anchors and session restore anchors active", () => {
    expect(
      pendingTranscriptAnchorId({
        hasNewExplicitAnchor: true,
        scrollAnchorId: "user-31",
        latestUserChanged: true,
        latestUserRowId: "message-user-33",
        following: false,
      }),
    ).toBe("user-31");

    expect(
      pendingTranscriptAnchorId({
        sessionChanged: true,
        latestUserRowId: "message-user-33",
        following: false,
      }),
    ).toBe("message-user-33");
  });
});
