import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CustomMessage } from "../../../gui/web/src/components/chat/custom-message.jsx";

// The disabled attribute itself, not Tailwind `disabled:` variant classes.
const DISABLED_BUTTON = /<button[^>]*\sdisabled=""[^>]*>Retry<\/button>/;

function renderStopped(props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    React.createElement(CustomMessage, {
      customType: "opencandle-run-cancelled",
      content: [{ type: "text", text: "Run stopped before it produced an answer." }],
      details: { text: "compare AAPL and MSFT", prompt: "compare AAPL and MSFT" },
      onRetry: vi.fn(),
      onFixModelKey: vi.fn(),
      ...props,
    }),
  );
}

describe("cancelled run custom message rendering", () => {
  it("shows a neutral Stopped label with the content, a Retry control, and no model-key recovery", () => {
    const html = renderStopped();

    expect(html).toContain("Stopped");
    expect(html).toContain("Run stopped before it produced an answer.");
    // The raw internal custom type must never be shown as a user-facing badge.
    expect(html).not.toContain("opencandle-run-cancelled");
    // A stopped run can be retried, but it is not a model failure.
    expect(html).toContain(">Retry</button>");
    expect(html).not.toMatch(DISABLED_BUTTON);
    expect(html).not.toContain(">Fix model key</button>");
  });

  it("disables Retry while another run is active", () => {
    expect(renderStopped({ retryDisabled: true })).toMatch(DISABLED_BUTTON);
  });

  it("offers no Retry when there is nothing to retry", () => {
    expect(renderStopped({ onRetry: undefined })).not.toContain(">Retry</button>");
  });
});
