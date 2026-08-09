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

import {
  AppContentArea,
  MobileHeader,
} from "../../../gui/web/src/features/layout/AppShellChrome.jsx";
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

const page = React.createElement("section", { "data-testid": "page" }, "Watchlists");
const contentArea = React.createElement(AppContentArea, null, page);
const statusElement = React.createElement("span", { "data-testid": "hosted-status" }, "Preparing");

function renderWithSlot(children: React.ReactNode, slot: React.ReactNode) {
  return renderToStaticMarkup(
    React.createElement(AppStatusSlotProvider, { slot }, children as React.ReactElement),
  );
}

function overlayClasses(html: string) {
  const match = html.match(/data-slot="app-status-overlay" class="([^"]*)"/);
  return match?.[1] ?? "";
}

describe("app status slot", () => {
  it("renders nothing when no host supplies a status element", () => {
    const html = renderToStaticMarkup(contentArea);

    expect(html).not.toContain("app-status-overlay");
    expect(html).toContain('data-testid="page"');
  });

  it("floats the supplied status element over the content column", () => {
    const html = renderWithSlot(contentArea, statusElement);

    expect(html).toContain('data-testid="hosted-status"');
    // The page owns the canvas: the status element comes after it in the
    // content wrapper and is positioned out of the layout flow.
    expect(html.indexOf('data-testid="page"')).toBeLessThan(
      html.indexOf('data-testid="hosted-status"'),
    );
    const classes = overlayClasses(html);
    expect(classes).toContain("absolute");
    expect(classes).toContain("justify-center");
    expect(classes).toContain("pointer-events-none");
  });

  it("takes pointer events on the status element only", () => {
    const html = renderWithSlot(contentArea, statusElement);
    const overlay = html.slice(html.indexOf('data-slot="app-status-overlay"'));

    expect(overlay).toMatch(/pointer-events-auto[^>]*"><span data-testid="hosted-status"/);
  });

  it("keeps the status element out of the sidebar header", () => {
    const html = renderWithSlot(sidebar, statusElement);

    expect(html).not.toContain('data-testid="hosted-status"');
    expect(html).toContain("OpenCandle");
  });

  it("keeps the status element out of the mobile header", () => {
    const html = renderWithSlot(mobileHeader, statusElement);

    expect(html).not.toContain('data-testid="hosted-status"');
  });
});
