import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const ReactModule = await import("react");
  return {
    Link: ({ to, params, children, ...props }) =>
      ReactModule.createElement(
        "a",
        { href: String(to).replace("$section", String(params?.section ?? "")), ...props },
        children,
      ),
  };
});

import { MobileHeader } from "../../../gui/web/src/features/layout/AppShellChrome.jsx";
import { SessionSidebar } from "../../../gui/web/src/features/sessions/SessionHistory.jsx";
import { AppStatusSlotProvider } from "../../../gui/web/src/runtime/app-status-slot.jsx";

const sidebar = React.createElement(SessionSidebar, {
  sessions: [],
  currentSessionId: "",
  currentPath: "/",
  collapsed: false,
  onCollapse: vi.fn(),
  onOpenSession: vi.fn(),
  onRenameSession: vi.fn(),
  onDeleteSession: vi.fn(),
  onNewSession: vi.fn(),
  onOpenHome: vi.fn(),
});

const mobileHeader = React.createElement(MobileHeader, {
  onOpenSidebar: vi.fn(),
  onOpenHome: vi.fn(),
});

function renderWithSlot(children: React.ReactNode, slot: React.ReactNode) {
  return renderToStaticMarkup(
    React.createElement(AppStatusSlotProvider, { slot }, children as React.ReactElement),
  );
}

describe("app status slot", () => {
  it("renders nothing when no host supplies a status element", () => {
    const html = renderToStaticMarkup(sidebar);

    expect(html).not.toContain("hosted-status");
    expect(html).toContain("OpenCandle");
  });

  it("renders the supplied status element after the sidebar logo", () => {
    const slot = React.createElement("span", { "data-testid": "hosted-status" }, "Preparing");
    const html = renderWithSlot(sidebar, slot);

    expect(html).toContain('data-testid="hosted-status"');
    expect(html.indexOf("OpenCandle</span>")).toBeLessThan(
      html.indexOf('data-testid="hosted-status"'),
    );
  });

  it("renders the same status element in the mobile header", () => {
    const slot = React.createElement("span", { "data-testid": "hosted-status" }, "Preparing");
    const html = renderWithSlot(mobileHeader, slot);

    expect(html).toContain('data-testid="hosted-status"');
  });
});
