// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInstrumentHistory } from "../../../gui/web/src/hooks/useInstrumentHistory.jsx";

type HookResult = {
  snapshot: unknown;
  loading: boolean;
  error: unknown;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function response(body: unknown, init: { ok?: boolean; statusText?: string } = {}) {
  return {
    ok: init.ok ?? true,
    statusText: init.statusText ?? "",
    json: vi.fn().mockResolvedValue(body),
  } as Response;
}

let latestResult: HookResult | undefined;
let root: Root | undefined;
let container: HTMLDivElement | undefined;
const originalFetch = globalThis.fetch;

function Probe({ symbol, range }: { symbol: string; range: string }) {
  latestResult = useInstrumentHistory(symbol, range);
  return null;
}

async function renderProbe(symbol: string, range: string) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => root?.render(React.createElement(Probe, { symbol, range })));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  latestResult = undefined;
  root = undefined;
  container = undefined;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("useInstrumentHistory", () => {
  it("fetches the requested instrument history and exposes pending and resolved state", async () => {
    const request = deferred<Response>();
    const body = { symbol: "AAPL", range: "1D", bars: [] };
    globalThis.fetch = vi.fn().mockReturnValue(request.promise);

    await renderProbe("AAPL", "1D");

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/instruments/history?symbol=AAPL&range=1D");
    expect(latestResult).toMatchObject({ snapshot: null, loading: true });
    expect(latestResult?.error).toBeFalsy();

    await act(async () => request.resolve(response(body)));

    expect(latestResult).toEqual({ snapshot: body, loading: false, error: null });
  });

  it("clears same-symbol history while a new range loads", async () => {
    const oneDay = deferred<Response>();
    const oneYear = deferred<Response>();
    globalThis.fetch = vi
      .fn()
      .mockReturnValueOnce(oneDay.promise)
      .mockReturnValueOnce(oneYear.promise);

    await renderProbe("AAPL", "1D");
    const oneDayBody = { symbol: "AAPL", range: "1D", bars: [{ time: 1 }] };
    await act(async () => oneDay.resolve(response(oneDayBody)));

    await renderProbe("AAPL", "1Y");

    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      "/api/instruments/history?symbol=AAPL&range=1Y",
    );
    expect(latestResult?.loading).toBe(true);
    expect(latestResult?.snapshot).toBeNull();

    const body = { symbol: "AAPL", range: "1Y", bars: [] };
    await act(async () => oneYear.resolve(response(body)));

    expect(latestResult).toEqual({ snapshot: body, loading: false, error: null });
  });

  it("does not expose the previous symbol after a replacement request fails", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ symbol: "AAPL", range: "1D", bars: [{ time: 1 }] }))
      .mockResolvedValueOnce(response({}, { ok: false, statusText: "provider unavailable" }));

    await renderProbe("AAPL", "1D");
    expect(latestResult?.snapshot).toMatchObject({ symbol: "AAPL" });

    await renderProbe("MSFT", "1D");

    expect(latestResult).toMatchObject({ snapshot: null, loading: false });
    expect(latestResult?.error).toContain("provider unavailable");
  });

  it("discards a superseded response that resolves out of order", async () => {
    const slowOneDay = deferred<Response>();
    const fastOneYear = deferred<Response>();
    globalThis.fetch = vi
      .fn()
      .mockReturnValueOnce(slowOneDay.promise)
      .mockReturnValueOnce(fastOneYear.promise);

    await renderProbe("AAPL", "1D");
    await renderProbe("AAPL", "1Y");

    const oneYearBody = { symbol: "AAPL", range: "1Y", bars: [{ time: 2 }] };
    await act(async () => fastOneYear.resolve(response(oneYearBody)));
    expect(latestResult?.snapshot).toBe(oneYearBody);

    await act(async () =>
      slowOneDay.resolve(response({ symbol: "AAPL", range: "1D", bars: [{ time: 1 }] })),
    );

    expect(latestResult).toEqual({ snapshot: oneYearBody, loading: false, error: null });
  });

  it("exposes non-ok responses as errors and clears loading", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(response({ reason: "provider unavailable" }, { ok: false }));

    await renderProbe("AAPL", "1D");

    expect(latestResult?.snapshot).toBeNull();
    expect(latestResult?.loading).toBe(false);
    expect(latestResult?.error).toBeTruthy();
  });

  it("passes stale and dataAsOf through on the snapshot", async () => {
    const body = {
      symbol: "AAPL",
      range: "1D",
      stale: true,
      dataAsOf: "2026-07-15",
      bars: [],
    };
    globalThis.fetch = vi.fn().mockResolvedValue(response(body));

    await renderProbe("AAPL", "1D");

    expect(latestResult?.snapshot).toBe(body);
    expect(latestResult?.snapshot).toMatchObject({
      stale: true,
      dataAsOf: "2026-07-15",
    });
  });
});
