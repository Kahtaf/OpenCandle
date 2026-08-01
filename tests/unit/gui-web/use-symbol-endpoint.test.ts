// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSymbolEndpoint } from "../../../gui/web/src/features/symbol/use-symbol-data.js";
import { RuntimeTransportContext } from "../../../gui/web/src/runtime/runtime-transport-context.js";

let latestResult: { snapshot: unknown; loading: boolean; error: string | null } | undefined;
let root: Root;
let container: HTMLDivElement;

function Probe({ symbol }: { symbol: string }) {
  latestResult = useSymbolEndpoint("quote", symbol);
  return null;
}

async function render(symbol: string, transport?: Record<string, unknown>) {
  const probe = React.createElement(Probe, { symbol });
  await act(async () =>
    root.render(
      transport
        ? React.createElement(RuntimeTransportContext.Provider, { value: transport }, probe)
        : probe,
    ),
  );
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useSymbolEndpoint", () => {
  it("routes quote reads through the canonical instrument quote transport", async () => {
    const getInstrumentQuote = vi.fn(async () => ({ symbol: "AAPL", status: "ok", price: 200 }));
    const getInstrumentEndpoint = vi.fn(async () => {
      throw new Error("instrument_endpoint quote is unsupported");
    });

    await render("AAPL", { getInstrumentQuote, getInstrumentEndpoint });

    expect(latestResult).toMatchObject({
      snapshot: { symbol: "AAPL", price: 200 },
      loading: false,
      error: null,
    });
    expect(getInstrumentQuote).toHaveBeenCalledWith("AAPL");
    expect(getInstrumentEndpoint).not.toHaveBeenCalled();
  });

  it("hides the previous ticker snapshot synchronously and keeps it hidden on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ symbol: "AAPL", status: "ok", price: 200 }))
        .mockResolvedValueOnce(new Response("", { status: 503, statusText: "Unavailable" })),
    );

    await render("AAPL");
    expect(latestResult?.snapshot).toMatchObject({ symbol: "AAPL", price: 200 });

    await render("MSFT");

    expect(latestResult).toMatchObject({ snapshot: null, loading: false, error: "Unavailable" });
  });
});
