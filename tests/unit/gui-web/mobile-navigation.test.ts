import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  HistoryItem,
  isSessionMenuLongPressPointer,
  sessionMenuLongPressDelayMs,
} from "../../../gui/web/src/components/chat/history-item.jsx";
import { MobileHeader } from "../../../gui/web/src/features/layout/AppShellChrome.jsx";

describe("mobile navigation affordances", () => {
  it("renders the OC logo as a home/new-chat control", () => {
    const html = renderToStaticMarkup(
      React.createElement(MobileHeader, {
        onOpenSidebar: vi.fn(),
        onOpenHome: vi.fn(),
      }),
    );

    expect(html).toContain('aria-label="Go to new chat"');
  });

  it("opens a session context menu after a touch long press", () => {
    vi.useFakeTimers();
    try {
      const html = renderToStaticMarkup(
        React.createElement(HistoryItem, {
          session: {
            id: "session-1",
            path: "session-1.json",
            name: "Long press session",
            modified: new Date().toISOString(),
          },
          active: false,
          onOpen: vi.fn(),
          onRename: vi.fn(),
          onDelete: vi.fn(),
        }),
      );

      expect(html).toContain("data-long-press-menu");
      expect(sessionMenuLongPressDelayMs).toBeGreaterThan(0);
      expect(isSessionMenuLongPressPointer("touch")).toBe(true);
      expect(isSessionMenuLongPressPointer("pen")).toBe(true);
      expect(isSessionMenuLongPressPointer("mouse")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
