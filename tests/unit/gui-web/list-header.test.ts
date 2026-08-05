import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ListHeader, ListTabs } from "../../../gui/web/src/components/ui/list-header.jsx";
import { nextListTabIndex } from "../../../gui/web/src/components/ui/list-header-navigation.js";

function tabsProps(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      { id: 1, name: "Core" },
      { id: 2, name: "AI infra" },
    ],
    activeItem: { id: 1, name: "Core" },
    counts: new Map([
      [1, 6],
      [2, 0],
    ]),
    renameLabel: "Rename watchlist",
    onSelect: () => undefined,
    onRename: () => undefined,
    ...overrides,
  };
}

describe("ListHeader", () => {
  it("keeps the rename control beside the active list name and reveals it on hover or focus", () => {
    const html = renderToStaticMarkup(React.createElement(ListTabs, tabsProps()));

    expect(html).toContain('data-slot="list-tabs"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Rename watchlist Core"');
    // The rename control lives inside the active tab group, not floated to the
    // far right of the strip.
    const activeTabIndex = html.indexOf(">Core<");
    const renameIndex = html.indexOf('aria-label="Rename watchlist Core"');
    const inactiveTabIndex = html.indexOf(">AI infra<");
    expect(activeTabIndex).toBeLessThan(renameIndex);
    expect(renameIndex).toBeLessThan(inactiveTabIndex);
    expect(html).toContain('data-slot="list-tab-rename"');
    // Hidden at rest on pointer surfaces, always present and touch sized below.
    expect(html).toContain("md:opacity-0");
    expect(html).toContain("md:group-hover:opacity-100");
    expect(html).toContain("md:group-focus-within:opacity-100");
    expect(html).toContain("size-10 min-h-10 min-w-10");
  });

  it("shows the item count on every tab, including a single list", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ListTabs,
        tabsProps({
          items: [{ id: 1, name: "Core" }],
          counts: new Map([[1, 6]]),
        }),
      ),
    );

    expect(html).toContain(">Core<");
    expect(html).toContain(">6<");
    expect(html).toContain('aria-label="Rename watchlist Core"');
  });

  it("keeps a roving tabindex and touch-sized controls", () => {
    const html = renderToStaticMarkup(React.createElement(ListTabs, tabsProps()));

    expect(html).toContain('tabindex="0"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("min-h-10");
  });

  it("hides the rename control when the surface is read only", () => {
    const html = renderToStaticMarkup(React.createElement(ListTabs, tabsProps({ readOnly: true })));

    expect(html).toContain('aria-label="Rename watchlist Core"');
    expect(html).toContain("disabled");
  });

  it("puts the title left and the primary action top right above the tabs", () => {
    const html = renderToStaticMarkup(
      React.createElement(ListHeader, {
        title: "Watchlists",
        actions: React.createElement("button", { type: "button" }, "New Watchlist"),
        tabs: React.createElement(ListTabs, tabsProps()),
      }),
    );

    expect(html).toContain('data-slot="list-header"');
    expect(html).toContain("<h1");
    expect(html).toContain("Watchlists");
    expect(html.indexOf("Watchlists")).toBeLessThan(html.indexOf("New Watchlist"));
    expect(html.indexOf("New Watchlist")).toBeLessThan(html.indexOf('data-slot="list-tabs"'));
  });

  it("moves between tabs with arrow keys", () => {
    expect(nextListTabIndex(0, 3, "ArrowRight")).toBe(1);
    expect(nextListTabIndex(2, 3, "ArrowRight")).toBe(0);
    expect(nextListTabIndex(0, 3, "ArrowLeft")).toBe(2);
    expect(nextListTabIndex(1, 3, "Home")).toBe(0);
    expect(nextListTabIndex(1, 3, "End")).toBe(2);
    expect(nextListTabIndex(1, 3, "Enter")).toBe(1);
  });
});
