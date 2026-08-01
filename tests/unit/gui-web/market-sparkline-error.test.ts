// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { MarketSparkline } from "../../../gui/web/src/components/market-sparkline.jsx";

afterEach(() => {
  document.body.replaceChildren();
});

describe("MarketSparkline failures", () => {
  it("replaces a failed proxy image with the unavailable state", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(MarketSparkline, { symbol: "AAPL", assetType: "equity" }));
    });
    const image = container.querySelector("img");
    expect(image?.src).toContain("/api/market-state/sparkline");

    await act(async () => image?.dispatchEvent(new Event("error")));

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Ticker Line · unavailable");
    await act(async () => root.unmount());
  });
});
