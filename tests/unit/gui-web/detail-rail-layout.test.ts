import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DetailRailLayout } from "../../../gui/web/src/components/ui/detail-rail-layout.jsx";

describe("DetailRailLayout", () => {
  it("gives the primary region the available width and the rail a fixed track", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        DetailRailLayout,
        { rail: React.createElement("aside", null, "Detail") },
        React.createElement("table", null),
      ),
    );

    expect(html).toContain('data-slot="detail-rail-layout"');
    expect(html).toContain("xl:grid-cols-[minmax(0,1fr)_320px]");
    expect(html).toContain("min-[1400px]:grid-cols-[minmax(0,1fr)_360px]");
    expect(html).toContain('data-slot="detail-rail"');
    // The rail is a desktop-only region; narrow viewports keep the page in one
    // column so the existing bottom-sheet inspector stays the mobile path.
    expect(html).toContain("hidden xl:flex");
  });

  it("stretches both regions to the page height so short lists do not float", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        DetailRailLayout,
        { rail: React.createElement("aside", null, "Detail") },
        React.createElement("table", null),
      ),
    );

    expect(html).toContain("xl:min-h-0");
    expect(html).toContain("xl:flex-1");
    expect(html).toContain("xl:items-stretch");
  });

  it("drops the rail track entirely when there is nothing to inspect", () => {
    const html = renderToStaticMarkup(
      React.createElement(DetailRailLayout, null, React.createElement("table", null)),
    );

    expect(html).not.toContain("xl:grid-cols-[minmax(0,1fr)_320px]");
    expect(html).not.toContain('data-slot="detail-rail"');
  });
});
