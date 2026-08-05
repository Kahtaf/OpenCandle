import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SymbolSearchInput } from "../../../gui/web/src/features/market-state/MarketStatePage.jsx";
import { PanelSearch } from "../../../gui/web/src/features/market-state/shared.jsx";

// The magnifier sits in the input's padding as an absolutely positioned
// overlay. A fixed `top-<n>` offset only lands on the centre line for one input
// height, so it drifts as soon as the field is taller or shorter - which is
// exactly what the responsive input does between mobile and desktop. Centre it
// against the field instead, the way every other icon-in-input in the design
// system does (see the catalog search and select chevrons).
function searchIconClass(html: string): string {
  const match = /<svg[^>]*class="([^"]*absolute[^"]*)"/.exec(html);
  return match?.[1] ?? "";
}

describe("search input magnifier alignment", () => {
  const cases: Array<[string, () => string]> = [
    [
      "watchlist and portfolio panel search",
      () =>
        renderToStaticMarkup(
          React.createElement(PanelSearch, {
            label: "Filter symbols",
            filter: "",
            setFilter: () => undefined,
          }),
        ),
    ],
    [
      "ticker search",
      () =>
        renderToStaticMarkup(
          React.createElement(SymbolSearchInput, {
            query: "AA",
            selected: "",
            disabled: false,
            onQueryChange: () => undefined,
            onSelectedChange: () => undefined,
          }),
        ),
    ],
  ];

  for (const [name, render] of cases) {
    it(`centres the ${name} magnifier against the field instead of a fixed offset`, () => {
      const iconClass = searchIconClass(render());

      expect(iconClass).toContain("top-1/2");
      expect(iconClass).toContain("-translate-y-1/2");
      expect(iconClass).not.toMatch(/(?:^|\s)top-(?!1\/2)/);
    });
  }
});
