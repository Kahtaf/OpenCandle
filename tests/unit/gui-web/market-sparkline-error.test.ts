// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketSparkline } from "../../../gui/web/src/components/market-sparkline.jsx";
import { RuntimeTransportProvider } from "../../../gui/web/src/runtime/runtime-transport-provider.jsx";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("MarketSparkline failures", () => {
  it("uses Ticker Line directly in the hosted browser runtime", async () => {
    const metadataFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          source: "Ticker Line",
          dataAsOf: "2026-07-31T19:45:00.000Z",
          svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", metadataFetch);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(
          RuntimeTransportProvider,
          { transport: { kind: "hosted" } },
          React.createElement(MarketSparkline, { symbol: "AAPL", assetType: "equity" }),
        ),
      );
    });

    expect(metadataFetch).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/ticker-line\.com\/v1\/sparkline\?.*ticker=AAPL.*format=json$/,
      ),
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
    expect(metadataFetch).toHaveBeenCalledOnce();
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(image?.getAttribute("crossorigin")).toBe("anonymous");

    await act(async () => image?.dispatchEvent(new Event("error")));

    // The provider name is gone, but the as-of is not alt-text only: a pointer
    // reader can reach it on the chart without the caption coming back.
    const chart = container.querySelector('[data-slot="market-sparkline"]');
    expect(chart?.getAttribute("data-state")).toBe("ready");
    expect(chart?.getAttribute("title")).toMatch(/^Price chart as of /);
    expect(chart?.getAttribute("title")).not.toMatch(/ticker\s*line/i);

    const retriedSource = container.querySelector("img")?.getAttribute("src") ?? "";
    expect(retriedSource).toMatch(/#retry=1$/);
    expect(decodeURIComponent(retriedSource.split(",")[1].split("#")[0])).toMatch(/<\/svg>$/);
    await act(async () => root.unmount());
  });

  it.each([
    [{ "x-error-code": "INSUFFICIENT_DATA", "x-error-status": "422" }],
    [{ "x-cache": "STALE" }],
  ])("rejects hosted Ticker Line semantic and stale fallbacks", async (headers) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            dataAsOf: "2026-07-31T19:45:00.000Z",
            svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
          }),
          { headers },
        ),
      ),
    );
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(
          RuntimeTransportProvider,
          { transport: { kind: "hosted" } },
          React.createElement(MarketSparkline, { symbol: "AAPL", assetType: "equity" }),
        ),
      );
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Unavailable");
    expect(container.innerHTML).not.toMatch(/ticker\s*line/i);
    await act(async () => root.unmount());
  });

  it("cancels an oversized hosted metadata stream at the shared response limit", async () => {
    const cancelStream = vi.fn();
    const oversizedBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(300 * 1024));
        controller.enqueue(new Uint8Array(300 * 1024));
      },
      cancel: cancelStream,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(oversizedBody)));
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(
          RuntimeTransportProvider,
          { transport: { kind: "hosted" } },
          React.createElement(MarketSparkline, { symbol: "AAPL", assetType: "equity" }),
        ),
      );
    });

    expect(cancelStream).toHaveBeenCalled();
    expect(container.textContent).toContain("Unavailable");
    expect(container.innerHTML).not.toMatch(/ticker\s*line/i);
    await act(async () => root.unmount());
  });

  it("times out a stalled hosted Ticker Line request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
          }),
      ),
    );
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(
          RuntimeTransportProvider,
          { transport: { kind: "hosted" } },
          React.createElement(MarketSparkline, { symbol: "AAPL", assetType: "equity" }),
        ),
      );
    });
    await act(async () => vi.advanceTimersByTimeAsync(20_001));

    expect(container.textContent).toContain("Unavailable");
    expect(container.innerHTML).not.toMatch(/ticker\s*line/i);
    await act(async () => root.unmount());
  });

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
    expect(container.textContent).toContain("Unavailable");
    expect(container.innerHTML).not.toMatch(/ticker\s*line/i);
    expect(container.querySelector('[data-slot="market-sparkline"]')?.getAttribute("title")).toBe(
      "Price chart is temporarily unavailable",
    );

    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));

    expect(container.querySelector("img")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("keeps the as-of date in accessible chart context without naming the provider", async () => {
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
    expect(container.textContent).not.toMatch(/ticker\s*line/i);
    expect(container.textContent?.trim()).toBe("");
    expect(container.querySelector("img")?.alt).toBe(
      "AAPL 1-day price chart, data as of Jul 31, 2026",
    );
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
