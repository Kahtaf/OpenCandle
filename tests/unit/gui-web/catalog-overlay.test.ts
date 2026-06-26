import { describe, expect, it } from "vitest";
import { buildCatalogToolInvokePayload } from "../../../gui/web/src/features/catalog/CatalogOverlay.jsx";

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
});
