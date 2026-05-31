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

  it("allows decimal financial number inputs", () => {
    const html = renderToStaticMarkup(React.createElement(MarketStatePage, {
      domain: "portfolios",
      role: "writer",
      send: () => false,
      navigate: () => undefined,
      setToast: () => undefined,
    }));

    expect(html).toContain('type="number"');
    expect(html).toContain('step="any"');
  });
});
