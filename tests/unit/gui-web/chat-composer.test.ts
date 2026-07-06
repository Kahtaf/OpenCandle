import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatComposer } from "../../../gui/web/src/components/chat/chat-composer.jsx";
import { TooltipProvider } from "../../../gui/web/src/components/ui/tooltip.jsx";

describe("ChatComposer", () => {
  function renderComposer(props: Partial<React.ComponentProps<typeof ChatComposer>> = {}) {
    return renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(ChatComposer, {
          draft: "am I too concentrated?",
          setDraft: vi.fn(),
          disabled: false,
          setupBlocked: false,
          placeholder: "Ask anything",
          canSend: true,
          onSubmit: vi.fn(),
          onOpenCatalog: vi.fn(),
          onOpenContext: vi.fn(),
          modelSetup: { requirement: "ready" },
          role: "writer",
          send: vi.fn(),
          setToast: vi.fn(),
          pendingAttachments: [],
          onAddAttachment: vi.fn(),
          onRemoveAttachment: vi.fn(),
          ...props,
        }),
      ),
    );
  }

  it("uses plus for attachments and eye wording for the context drawer", () => {
    const html = renderComposer();

    expect(html).toContain('aria-label="Attach context"');
    expect(html).toContain("Attach");
    expect(html).not.toContain('aria-label="Open catalog"');
    expect(html).toContain('aria-label="What the agent sees"');
  });

  it("renders pending saved-context chips and image thumbnails", () => {
    const html = renderComposer({
      pendingAttachments: [
        { kind: "portfolio", label: "Portfolio" },
        {
          kind: "image",
          name: "chart.png",
          data: "iVBORw0KGgo=",
          mimeType: "image/png",
        },
      ],
    });

    expect(html).toContain("Portfolio");
    expect(html).toContain("chart.png");
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
  });

  it("wires clipboard image paste into the pending attachment flow", () => {
    const source = readFileSync(resolve("gui/web/src/components/chat/chat-composer.jsx"), "utf-8");

    expect(source).toContain("onPaste");
    expect(source).toContain("imageFilesFromClipboardData");
    expect(source).toContain("attachmentsFromImageFiles");
    expect(source).toContain("onAddAttachment");
  });
});
