import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildWatchlistRowActions,
  MarketStatePage,
} from "../../../gui/web/src/features/market-state/MarketStatePage.jsx";

describe("MarketStatePage rendering", () => {
  it("offers a skip-for-now path on the empty portfolio page", () => {
    const html = renderToStaticMarkup(React.createElement(MarketStatePage, {
      domain: "portfolios",
      role: "writer",
      send: () => false,
      navigate: () => undefined,
      setToast: () => undefined,
    }));

    expect(html).toContain("No holdings yet");
    expect(html).toContain("Skip For Now");
  });

  it("uses the shared app shell chrome without duplicate section tabs", () => {
    const html = renderToStaticMarkup(React.createElement(MarketStatePage, {
      domain: "watchlists",
      role: "writer",
      send: () => false,
      navigate: () => undefined,
      setToast: () => undefined,
      onOpenSidebar: () => undefined,
    }));

    expect(html).toContain('aria-label="Open sidebar"');
    expect(html).not.toContain('aria-label="Market state sections"');
  });

  it("renders report templates as durable report state", () => {
    const html = renderToStaticMarkup(React.createElement(MarketStatePage, {
      domain: "reports",
      role: "writer",
      send: () => false,
      navigate: () => undefined,
      setToast: () => undefined,
    }));

    expect(html).toContain("Report Templates");
  });

  it("uses explicit refresh-prices copy and keeps creation flows contextual", () => {
    const html = renderToStaticMarkup(React.createElement(MarketStatePage, {
      domain: "watchlists",
      role: "writer",
      send: () => false,
      navigate: () => undefined,
      setToast: () => undefined,
    }));

    expect(html).toContain("Refresh prices");
    expect(html).not.toContain(">Quotes<");
    expect(html).toContain("Default Watchlist");
    expect(html).not.toContain("Search Yahoo candidates before saving");
  });

  it("renders alert event history as durable alert state", () => {
    const html = renderToStaticMarkup(React.createElement(MarketStatePage, {
      domain: "alerts",
      role: "writer",
      send: () => false,
      navigate: () => undefined,
      setToast: () => undefined,
    }));

    expect(html).toContain("Alert Events");
  });

  it("frames predictions as thesis tracking in the GUI", () => {
    const html = renderToStaticMarkup(React.createElement(MarketStatePage, {
      domain: "predictions",
      role: "writer",
      send: () => false,
      navigate: () => undefined,
      setToast: () => undefined,
    }));

    expect(html).toContain("Thesis Tracker");
    expect(html).toContain("Record thesis");
  });

  it("keeps follower mode readable while disabling mutation actions", () => {
    const html = renderToStaticMarkup(React.createElement(MarketStatePage, {
      domain: "alerts",
      role: "follower",
      send: () => false,
      navigate: () => undefined,
      setToast: () => undefined,
    }));

    expect(html).toContain("Follower mode: read-only");
    expect(html).toContain("Create alert");
    expect(html).toContain("disabled");
  });

  it("does not create a watchlist alert without an explicit target", () => {
    const invokeTool = () => {
      throw new Error("unexpected invoke");
    };

    const actions = buildWatchlistRowActions({
      symbol: "AAPL",
      targetPrice: null,
    }, invokeTool);

    expect(actions[0]).toEqual(expect.objectContaining({
      label: "Set target first",
      disabled: true,
    }));
  });

  it("creates a watchlist alert with the saved target as threshold", () => {
    const calls = [];
    const actions = buildWatchlistRowActions({
      symbol: "AAPL",
      targetPrice: 250,
    }, (toolName, args) => calls.push({ toolName, args }));

    actions[0].onClick();

    expect(calls).toEqual([{
      toolName: "manage_alerts",
      args: { action: "create_price_above", symbol: "AAPL", threshold: 250 },
    }]);
  });

  it("keeps holding forms out of the first viewport", () => {
    const html = renderToStaticMarkup(React.createElement(MarketStatePage, {
      domain: "portfolios",
      role: "writer",
      send: () => false,
      navigate: () => undefined,
      setToast: () => undefined,
    }));

    expect(html).toContain("Add holding");
    expect(html).toContain("Default Portfolio");
    expect(html).not.toContain("Use the lot id shown in the portfolio table");
  });
});
