import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildCatalogToolInvokePayload,
  CatalogList,
  formatArgsForPrompt,
} from "../../../gui/web/src/features/catalog/CatalogOverlay.jsx";

describe("CatalogOverlay helpers", () => {
  it("routes direct tool invocation payloads to the visible session", () => {
    expect(
      buildCatalogToolInvokePayload("get_stock_quote", { symbol: "NVDA" }, "route-session"),
    ).toEqual({
      toolName: "get_stock_quote",
      args: { symbol: "NVDA" },
      sessionId: "route-session",
    });
  });

  it("serializes structured args for chat prompt previews", () => {
    expect(
      formatArgsForPrompt({
        filter: [{ field: "market_cap", op: "greater", value: 1000000000 }],
        sort: { field: "volume", direction: "desc" },
      }),
    ).toBe(
      ' with filter=[{"field":"market_cap","op":"greater","value":1000000000}], sort={"field":"volume","direction":"desc"}',
    );
  });

  it("offers run surfaces only: workflows and tools, never providers", () => {
    const html = renderToStaticMarkup(
      React.createElement(CatalogList, {
        tab: "workflows",
        query: "",
        catalog: {
          workflows: [{ id: "compare_assets", name: "Compare Assets", description: "Compare." }],
          tools: [],
          providers: [
            { id: "alpha_vantage", kind: "api-key", displayName: "Alpha Vantage", unlocks: [] },
          ],
        },
        onSelect: () => {},
      }),
    );

    expect(html).toContain("Workflows");
    expect(html).toContain("Tools");
    expect(html).not.toContain("Providers");
    expect(html).not.toContain("Alpha Vantage");
  });

  it("renders grouped cmdk options inside an internal scroll region", () => {
    const html = renderToStaticMarkup(
      React.createElement(CatalogList, {
        tab: "tools",
        query: "",
        catalog: {
          tools: [
            {
              name: "get_stock_quote",
              label: "Stock quote",
              description: "Get the latest stock price.",
              domain: "market",
            },
          ],
        },
        onSelect: () => {},
      }),
    );

    expect(html).toContain('data-slot="command-list"');
    expect(html).toContain('data-slot="command-item"');
    expect(html).toContain('role="option"');
    expect(html).toContain("Market");
    expect(html).toContain("get_stock_quote");
    expect(html).toContain("!max-h-none flex-1");
    expect(html).toContain('aria-label="Catalog keyboard shortcuts"');
    expect(html).toContain("↑↓");
    expect(html).toContain("↵");
    expect(html).toContain("esc");
  });
});
