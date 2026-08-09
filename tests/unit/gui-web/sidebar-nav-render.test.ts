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

import { SessionSidebar } from "../../../gui/web/src/features/sessions/SessionHistory.jsx";

function renderSidebar(currentPath = "/") {
  return renderToStaticMarkup(
    React.createElement(SessionSidebar, {
      sessions: [],
      currentSessionId: "",
      currentPath,
      collapsed: false,
      onCollapse: vi.fn(),
      onOpenSession: vi.fn(),
      onRenameSession: vi.fn(),
      onDeleteSession: vi.fn(),
      onNewSession: vi.fn(),
      onOpenHome: vi.fn(),
    }),
  );
}

function group(html: string, slot: string) {
  const start = html.indexOf(`data-slot="${slot}"`);
  if (start < 0) return "";
  const next = html.indexOf('data-slot="', start + slot.length + 12);
  return html.slice(start, next < 0 ? undefined : next);
}

describe("sidebar header row", () => {
  it("keeps new chat and collapse as icon controls beside the wordmark", () => {
    const html = renderSidebar();

    expect(html).toContain('aria-label="New chat"');
    expect(html).toContain('aria-label="Collapse sidebar"');
    expect(html.indexOf("OpenCandle</span>")).toBeLessThan(html.indexOf('aria-label="New chat"'));
    expect(html.indexOf('aria-label="New chat"')).toBeLessThan(
      html.indexOf('aria-label="Collapse sidebar"'),
    );
  });

  it("drops the full-width New chat button row", () => {
    const html = renderSidebar();

    expect(html).not.toContain("New chat</button>");
  });

  it("never truncates the wordmark", () => {
    const html = renderSidebar();
    const wordmark = html.slice(0, html.indexOf("OpenCandle</span>"));

    expect(wordmark).toContain("whitespace-nowrap");
  });
});

describe("sidebar navigation groups", () => {
  it("keeps Diagnostics out of the Market State group", () => {
    const marketState = group(renderSidebar(), "market-state-nav");

    expect(marketState).toContain("Watchlists");
    expect(marketState).toContain("Portfolios");
    expect(marketState).toContain("Alerts");
    expect(marketState).toContain("Reports");
    expect(marketState).not.toContain("Diagnostics");
    expect(marketState).not.toContain('href="/diagnostics"');
  });

  it("renders a Settings entry in its own group below Market State", () => {
    const html = renderSidebar();

    expect(html.indexOf('data-slot="market-state-nav"')).toBeLessThan(
      html.indexOf('data-slot="app-nav"'),
    );
    const app = group(html, "app-nav");
    expect(app).toContain('href="/settings"');
    expect(app).toContain("Settings");
    expect(app).toContain("lucide-settings");
  });

  it.each(["/settings", "/settings/providers", "/diagnostics"])(
    "marks Settings active on %s",
    (path) => {
      const app = group(renderSidebar(path), "app-nav");

      expect(app).toMatch(/href="\/settings"[^>]*aria-current="page"/);
    },
  );

  it.each(["/", "/watchlists", "/sessions/abc"])("leaves Settings inactive on %s", (path) => {
    const app = group(renderSidebar(path), "app-nav");

    expect(app).not.toContain('aria-current="page"');
  });
});
