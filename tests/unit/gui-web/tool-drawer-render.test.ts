import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MobileToolDrawerContent } from "../../../gui/web/src/features/chat/tool-drawer.jsx";

describe("ToolDrawerOverlay", () => {
  it("uses the shared bottom-sheet chrome", () => {
    const html = renderToStaticMarkup(
      React.createElement(MobileToolDrawerContent, {
        run: {
          status: "completed",
          steps: [{ id: "step-1", name: "get_stock_quote", status: "completed" }],
        },
        onClose: () => undefined,
        Surface: "section",
        Title: "span",
      }),
    );

    expect(html).toContain("inset-x-2");
    expect(html).toContain("rounded-t-xl");
    expect(html).toContain("h-1 w-9");
    expect(html).toContain("bg-secondary shadow-subtle-md");
    expect(html).not.toContain("overscroll-contain bg-background");
  });
});
