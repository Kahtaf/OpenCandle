// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketSparkline } from "../../../gui/web/src/components/market-sparkline.jsx";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("MarketSparkline failures", () => {
  it("retries a transient proxy failure once before showing a provider failure", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(
          async () =>
            new Response(
              JSON.stringify({ source: "Ticker Line", dataAsOf: "2026-07-31T19:45:00.000Z" }),
              { headers: { "content-type": "application/json" } },
            ),
        ),
    );
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

    const retryImage = container.querySelector("img");
    expect(retryImage?.src).toContain("retry=1");

    await act(async () => retryImage?.dispatchEvent(new Event("error")));

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Ticker Line · provider unavailable");
    expect(container.querySelector("figure")?.title).toBe("Ticker Line is temporarily unavailable");

    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));

    expect(container.querySelector("img")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("shows the provider as-of date in visible and accessible chart context", async () => {
    const metadataFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ source: "Ticker Line", dataAsOf: "2026-07-31T19:45:00.000Z" }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", metadataFetch);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(MarketSparkline, { symbol: "AAPL", assetType: "equity" }));
    });

    expect(metadataFetch).toHaveBeenCalledWith(
      "/api/market-state/sparkline?symbol=AAPL&assetType=equity&metadata=1",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
    expect(container.textContent).toContain("Ticker Line · Jul 31, 2026");
    expect(container.querySelector("img")?.alt).toContain("data as of Jul 31, 2026");
    expect(container.querySelector("img")?.getAttribute("src")).toContain(
      "asOf=2026-07-31T19%3A45%3A00.000Z",
    );
    await act(async () => root.unmount());
  });

  it("refreshes sparkline metadata on the five-minute proxy cache cadence", async () => {
    vi.useFakeTimers();
    const metadataFetch = vi
      .fn()
      .mockImplementation(async () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ source: "Ticker Line", dataAsOf: "2026-07-31T19:45:00.000Z" }),
            { headers: { "content-type": "application/json" } },
          ),
        ),
      );
    vi.stubGlobal("fetch", metadataFetch);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(MarketSparkline, { symbol: "AAPL", assetType: "equity" }));
    });
    expect(metadataFetch).toHaveBeenCalledOnce();

    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));

    expect(metadataFetch).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });

  it("starts the refresh cadence after the prior metadata request settles", async () => {
    vi.useFakeTimers();
    let resolveFirstFetch = () => {};
    const firstFetch = new Promise((resolve) => {
      resolveFirstFetch = resolve;
    });
    const response = () =>
      new Response(
        JSON.stringify({ source: "Ticker Line", dataAsOf: "2026-07-31T19:45:00.000Z" }),
        { headers: { "content-type": "application/json" } },
      );
    const metadataFetch = vi
      .fn()
      .mockImplementationOnce(async () => firstFetch)
      .mockImplementation(async () => response());
    vi.stubGlobal("fetch", metadataFetch);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(MarketSparkline, { symbol: "AAPL", assetType: "equity" }));
    });
    expect(metadataFetch).toHaveBeenCalledOnce();

    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(metadataFetch).toHaveBeenCalledOnce();

    await act(async () => resolveFirstFetch(response()));
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));

    expect(metadataFetch).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });

  it("keeps metadata polling lazy until the sparkline approaches the viewport", async () => {
    let reportIntersection = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function IntersectionObserver(callback) {
        reportIntersection = callback;
        return { observe, disconnect };
      }),
    );
    const metadataFetch = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ source: "Ticker Line", dataAsOf: "2026-07-31T19:45:00.000Z" }),
            { headers: { "content-type": "application/json" } },
          ),
      );
    vi.stubGlobal("fetch", metadataFetch);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(MarketSparkline, { symbol: "AAPL", assetType: "equity" }));
    });
    expect(observe).toHaveBeenCalledOnce();
    expect(metadataFetch).not.toHaveBeenCalled();

    await act(async () => reportIntersection([{ isIntersecting: true }]));

    expect(metadataFetch).toHaveBeenCalledOnce();
    expect(observe.mock.calls[0][0].isConnected).toBe(true);
    await act(async () => root.unmount());
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
