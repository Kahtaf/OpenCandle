import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("floats the Latest control over the transcript as a pill with no reserved row", () => {
    const source = readFileSync(resolve("gui/web/src/features/chat/ChatPanel.jsx"), "utf-8");
    const latestStart = source.indexOf('data-slot="jump-to-latest"');
    const latestSource = source.slice(latestStart, source.indexOf("</Button>", latestStart));

    expect(latestStart).toBeGreaterThan(-1);
    // Floats over the scroll viewport instead of reserving a layout row, and
    // only the pill itself takes pointer events.
    expect(latestSource).toContain("pointer-events-none absolute");
    expect(latestSource).toContain("justify-center");
    expect(latestSource).toContain("pointer-events-auto");
    // Same pill geometry as the hosted status pill: 28px chrome with a
    // pseudo-expanded 40px pointer target.
    expect(latestSource).toContain("h-7 min-h-7");
    expect(latestSource).toContain("before:-inset-y-1.5");
    expect(latestSource).not.toContain("h-12 shrink-0");
    expect(source).toContain("transcript.showJumpToLatest ? (");
    expect(source).toContain("setShowJumpToLatest(false)");
  });
});
