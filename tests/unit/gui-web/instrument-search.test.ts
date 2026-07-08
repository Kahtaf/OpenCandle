import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InstrumentSuggestionList } from "../../../gui/web/src/features/instruments/instrument-search.jsx";
import {
  formatInstrumentCandidateLabel,
  formatInstrumentCandidateMeta,
  nextInstrumentActiveIndex,
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
    expect(html).toContain("NMS");
    expect(html).toContain("EQUITY");
  });

  it("formats candidate labels and keyboard movement consistently", () => {
    expect(formatInstrumentCandidateLabel({ symbol: "MSFT", quoteType: "EQUITY" })).toBe("EQUITY");
    expect(formatInstrumentCandidateMeta(candidates[0])).toBe("NMS · EQUITY");

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
});
