import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InstrumentSuggestionList } from "../../../gui/web/src/features/instruments/instrument-search.jsx";
import {
  formatInstrumentCandidateLabel,
  formatInstrumentCandidateMeta,
  navigateToInstrumentCandidate,
  nextInstrumentActiveIndex,
  rankInstrumentCandidates,
  resolveInstrumentSearchState,
} from "../../../gui/web/src/features/instruments/instrument-search-helpers.js";

describe("instrument search UI helpers", () => {
  const candidates = [
    {
      provider: "yahoo",
      symbol: "AAPL",
      name: "Apple Inc.",
      exchange: "NMS",
      quoteType: "EQUITY",
    },
  ];

  it("wires candidate page actions to encoded client navigation", () => {
    const navigate = vi.fn();

    navigateToInstrumentCandidate(navigate, { symbol: "^GSPC" });

    expect(navigate).toHaveBeenCalledWith({ to: "/symbol/%5EGSPC" });
  });

  it("renders a shared listbox row with optional cashtag symbol prefix", () => {
    const html = renderToStaticMarkup(
      React.createElement(InstrumentSuggestionList, {
        id: "ticker-suggestions",
        optionIdPrefix: "ticker-suggestion",
        candidates,
        activeIndex: 0,
        symbolPrefix: "$",
        onSelect: () => undefined,
      }),
    );

    expect(html).toContain('role="listbox"');
    expect(html).toContain('role="option"');
    expect(html).toContain('id="ticker-suggestion-option-0"');
    expect(html).toContain("$AAPL");
    expect(html).toContain("Apple Inc.");
    expect(html).toContain("Nasdaq");
    expect(html).toContain("Stock");
  });

  it("renders a focus-visible symbol-page action when navigation is available", () => {
    const html = renderToStaticMarkup(
      React.createElement(InstrumentSuggestionList, {
        id: "ticker-suggestions",
        optionIdPrefix: "ticker-suggestion",
        candidates: [{ ...candidates[0], symbol: "^GSPC", name: "S&P 500" }],
        activeIndex: 0,
        navigate: vi.fn(),
        onSelect: () => undefined,
      }),
    );

    expect(html).toContain('href="/symbol/%5EGSPC"');
    expect(html).toContain("Open ^GSPC page");
    expect(html).toContain("focus-visible:ring-2");
  });

  it("formats candidate labels and keyboard movement consistently", () => {
    expect(formatInstrumentCandidateLabel({ symbol: "MSFT", quoteType: "EQUITY" })).toBe("EQUITY");
    expect(formatInstrumentCandidateMeta(candidates[0])).toBe("Nasdaq · Stock");

    expect(nextInstrumentActiveIndex(-1, 3, "next")).toBe(0);
    expect(nextInstrumentActiveIndex(2, 3, "next")).toBe(0);
    expect(nextInstrumentActiveIndex(0, 3, "previous", { wrap: false })).toBe(0);
  });

  it("hides stale candidates while a new query is waiting for fresh results", () => {
    const staleState = {
      query: "AA",
      activeIndex: 0,
      candidates: [{ provider: "yahoo", symbol: "AAPL", name: "Apple Inc." }],
    };

    expect(
      resolveInstrumentSearchState({
        state: staleState,
        query: "MS",
        enabled: true,
        minLength: 1,
        initialActiveIndex: 0,
      }),
    ).toEqual({ candidates: [], activeIndex: 0 });
    expect(
      resolveInstrumentSearchState({
        state: staleState,
        query: "AA",
        enabled: true,
        minLength: 1,
        initialActiveIndex: 0,
      }).candidates,
    ).toEqual(staleState.candidates);
  });

  it("stably demotes FX crosses for an equity-looking query", () => {
    const mixedCandidates = [
      { symbol: "NOKAMD=X", quoteType: "CURRENCY" },
      { symbol: "AMD", quoteType: "EQUITY" },
      { symbol: "AMDQ", quoteType: "ETF" },
      { symbol: "AUDAMD=X", quoteType: "CURRENCY" },
      { symbol: "^AMD", quoteType: "INDEX" },
      { symbol: "GBPAMD=X", quoteType: "FX" },
    ];

    expect(rankInstrumentCandidates(mixedCandidates, "AMD").map(({ symbol }) => symbol)).toEqual([
      "AMD",
      "AMDQ",
      "^AMD",
      "NOKAMD=X",
      "AUDAMD=X",
      "GBPAMD=X",
    ]);
  });

  it.each(["EURUSD", "NOKAMD=X", "EUR/USD"])(
    "preserves provider order for the FX-looking query %s",
    (query) => {
      const mixedCandidates = [
        { symbol: "EURUSD=X", quoteType: "CURRENCY" },
        { symbol: "EUR", quoteType: "EQUITY" },
      ];

      expect(rankInstrumentCandidates(mixedCandidates, query)).toEqual(mixedCandidates);
    },
  );
});
