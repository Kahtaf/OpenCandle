import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketStatePage } from "../../../gui/web/src/features/market-state/MarketStatePage.jsx";

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
});
