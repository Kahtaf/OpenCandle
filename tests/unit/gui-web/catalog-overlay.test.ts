import { describe, expect, it } from "vitest";
import {
  buildCatalogToolInvokePayload,
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
});
