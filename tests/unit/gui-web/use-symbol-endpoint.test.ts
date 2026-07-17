// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSymbolEndpoint } from "../../../gui/web/src/features/symbol/use-symbol-data.js";

let latestResult: { snapshot: unknown; loading: boolean; error: string | null } | undefined;
let root: Root;
let container: HTMLDivElement;

function Probe({ symbol }: { symbol: string }) {
  latestResult = useSymbolEndpoint("quote", symbol);
  return null;
}

async function render(symbol: string) {
  await act(async () => root.render(React.createElement(Probe, { symbol })));
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
