import { describe, expect, it } from "vitest";
import { appPageFromPath, tickerFromPath } from "../../../gui/web/src/route-resolution.js";
import { router } from "../../../gui/web/src/router.jsx";

describe("tickerFromPath", () => {
  it.each([
    ["/symbol/AAPL", "AAPL"],
    ["/symbol/aapl", "AAPL"],
    ["/symbol/%5EGSPC", "^GSPC"],
    ["/symbol/BRK-B", "BRK-B"],
    ["/symbol/BTC-USD", "BTC-USD"],
  ])("resolves %s to %s", (pathname, expected) => {
    expect(tickerFromPath(pathname)).toBe(expected);
  });

  it.each([
    "/symbol/",
    "/symbol/A/B",
    "/watchlists",
    "/",
    "/symbol/%3Cscript%3E",
  ])("does not resolve %s", (pathname) => {
    expect(tickerFromPath(pathname)).toBe("");
  });
});

describe("symbol route", () => {
  it("registers /symbol/$ticker with the GUI search validator", () => {
    const route = router.routesByPath["/symbol/$ticker"];

    expect(route).toBeDefined();
    expect(route.options.validateSearch({ drawer: "history", prompt: "AAPL" })).toEqual({
      drawer: "history",
      provider: undefined,
      prompt: "AAPL",
      messageId: undefined,
      researchId: undefined,
      synthesisId: undefined,
    });
  });
});

describe("AppShell page precedence", () => {
  it("selects diagnostics, symbol, market-state, then chat fallthrough", () => {
    expect([
      appPageFromPath("/diagnostics"),
      appPageFromPath("/symbol/aapl"),
      appPageFromPath("/watchlists"),
      appPageFromPath("/sessions/abc"),
    ]).toEqual([
      { page: "diagnostics" },
      { page: "symbol", ticker: "AAPL" },
      { page: "market-state", domain: "watchlists" },
      { page: "chat" },
    ]);
  });
});
