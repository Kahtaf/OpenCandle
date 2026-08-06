import { describe, expect, it } from "vitest";
import {
  appPageFromPath,
  symbolPageHref,
  tickerFromPath,
} from "../../../gui/web/src/route-resolution.js";
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

  it.each(["ES=F", "EURUSD=X"])("round-trips the supported = symbol %s", (symbol) => {
    expect(tickerFromPath(symbolPageHref(symbol))).toBe(symbol);
  });

  it.each(["/symbol/", "/symbol/A/B", "/watchlists", "/", "/symbol/%3Cscript%3E"])(
    "does not resolve %s",
    (pathname) => {
      expect(tickerFromPath(pathname)).toBe("");
    },
  );
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
      alertSymbol: undefined,
      alertThreshold: undefined,
    });
  });
});

describe("alerts route", () => {
  it("keeps a level handed over in the link, however the search parser typed it", () => {
    const route = router.routesByPath["/alerts"];

    // The router's default parser reads a bare number out of the query string,
    // so a price level arrives typed rather than as text.
    expect(
      route.options.validateSearch({ alertSymbol: "MSFT", alertThreshold: 401.15 }),
    ).toMatchObject({ alertSymbol: "MSFT", alertThreshold: "401.15" });
    expect(
      route.options.validateSearch({ alertSymbol: "MSFT", alertThreshold: "401.15" }),
    ).toMatchObject({ alertThreshold: "401.15" });
    expect(route.options.validateSearch({ alertThreshold: { level: 1 } })).toMatchObject({
      alertThreshold: undefined,
    });
  });
});

describe("history route", () => {
  it("redirects the legacy drawer route to the home page", () => {
    const route = router.routesByPath["/history"];
    let redirectResult: { options?: { to?: string } } | undefined;

    try {
      route.options.beforeLoad?.({});
    } catch (error) {
      redirectResult = error as { options?: { to?: string } };
    }

    expect(redirectResult?.options?.to).toBe("/");
  });
});

describe("AppShell page precedence", () => {
  it("selects settings, symbol, market-state, then chat fallthrough", () => {
    expect([
      appPageFromPath("/diagnostics"),
      appPageFromPath("/symbol/aapl"),
      appPageFromPath("/watchlists"),
      appPageFromPath("/sessions/abc"),
    ]).toEqual([
      { page: "settings", section: "diagnostics" },
      { page: "symbol", ticker: "AAPL" },
      { page: "market-state", domain: "watchlists" },
      { page: "chat" },
    ]);
  });
});
