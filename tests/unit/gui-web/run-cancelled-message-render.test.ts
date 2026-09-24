import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CustomMessage } from "../../../gui/web/src/components/chat/custom-message.jsx";

describe("cancelled run custom message rendering", () => {
  it("shows a neutral Stopped label with the content and no raw custom-type badge or recovery actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(CustomMessage, {
        customType: "opencandle-run-cancelled",
        content: [{ type: "text", text: "Run stopped before it produced an answer." }],
        details: { text: "compare AAPL and MSFT" },
        onRetry: vi.fn(),
        onFixModelKey: vi.fn(),
      }),
    );

    expect(html).toContain("Stopped");
    expect(html).toContain("Run stopped before it produced an answer.");
    // The raw internal custom type must never be shown as a user-facing badge.
    expect(html).not.toContain("opencandle-run-cancelled");
    // Not a model failure: no retry / fix-key recovery controls.
    expect(html).not.toContain(">Retry</button>");
    expect(html).not.toContain(">Fix model key</button>");
  });
});
