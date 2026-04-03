import { describe, it, expect } from "vitest";
import {
  parseAnalystOutput,
  tallyVotes,
  collectEvidence,
} from "../../../src/analysts/contracts.js";
import type { AnalystOutput } from "../../../src/runtime/workflow-types.js";

describe("parseAnalystOutput", () => {
  it("extracts signal, conviction, and thesis from valid output", () => {
    const text = `Analysis of AAPL...
SIGNAL: BUY
CONVICTION: 8
THESIS: Strong fundamentals with accelerating revenue growth`;

    const result = parseAnalystOutput("valuation", text);
    expect(result.signal).toBe("BUY");
    expect(result.conviction).toBe(8);
    expect(result.thesis).toBe("Strong fundamentals with accelerating revenue growth");
    expect(result.role).toBe("valuation");
    expect(result.rawText).toBe(text);
  });

  it("handles SELL signal", () => {
    const text = `SIGNAL: SELL\nCONVICTION: 3\nTHESIS: Overvalued`;
    const result = parseAnalystOutput("contrarian", text);
    expect(result.signal).toBe("SELL");
    expect(result.conviction).toBe(3);
  });

  it("handles HOLD signal", () => {
    const text = `SIGNAL: HOLD\nCONVICTION: 5\nTHESIS: Neutral`;
    const result = parseAnalystOutput("risk", text);
    expect(result.signal).toBe("HOLD");
  });

  it("falls back to defaults when parsing fails", () => {
    const text = "Some analysis without structured output";
    const result = parseAnalystOutput("momentum", text);
    expect(result.signal).toBe("HOLD");
    expect(result.conviction).toBe(5);
    expect(result.thesis).toBe("");
    expect(result.rawText).toBe(text);
  });

  it("handles case-insensitive signal matching", () => {
    const text = "SIGNAL: buy\nCONVICTION: 7\nTHESIS: bullish";
    const result = parseAnalystOutput("valuation", text);
    expect(result.signal).toBe("BUY");
  });

  it("rejects conviction outside 1-10 range", () => {
    const text = "SIGNAL: BUY\nCONVICTION: 15\nTHESIS: test";
    const result = parseAnalystOutput("valuation", text);
    expect(result.conviction).toBe(5); // falls back to default
  });
});

describe("tallyVotes", () => {
  it("tallies votes from analyst outputs", () => {
    const outputs: AnalystOutput[] = [
      { role: "valuation", signal: "BUY", conviction: 7, thesis: "", evidence: [] },
      { role: "momentum", signal: "BUY", conviction: 8, thesis: "", evidence: [] },
      { role: "options", signal: "BUY", conviction: 6, thesis: "", evidence: [] },
      { role: "contrarian", signal: "HOLD", conviction: 5, thesis: "", evidence: [] },
      { role: "risk", signal: "SELL", conviction: 4, thesis: "", evidence: [] },
    ];

    const tally = tallyVotes(outputs);
    expect(tally.buy).toBe(3);
    expect(tally.hold).toBe(1);
    expect(tally.sell).toBe(1);
    expect(tally.verdict).toBe("BUY");
  });

  it("returns SELL verdict when weighted sum is negative", () => {
    const outputs: AnalystOutput[] = [
      { role: "a", signal: "SELL", conviction: 9, thesis: "", evidence: [] },
      { role: "b", signal: "SELL", conviction: 8, thesis: "", evidence: [] },
      { role: "c", signal: "BUY", conviction: 3, thesis: "", evidence: [] },
    ];

    const tally = tallyVotes(outputs);
    expect(tally.verdict).toBe("SELL");
  });

  it("returns HOLD verdict when weighted sum is zero", () => {
    const outputs: AnalystOutput[] = [
      { role: "a", signal: "BUY", conviction: 5, thesis: "", evidence: [] },
      { role: "b", signal: "SELL", conviction: 5, thesis: "", evidence: [] },
    ];

    const tally = tallyVotes(outputs);
    expect(tally.verdict).toBe("HOLD");
  });

  it("handles empty outputs", () => {
    const tally = tallyVotes([]);
    expect(tally.buy).toBe(0);
    expect(tally.hold).toBe(0);
    expect(tally.sell).toBe(0);
    expect(tally.weightedConviction).toBe(0);
  });
});

describe("collectEvidence", () => {
  it("collects evidence from all outputs", () => {
    const outputs: AnalystOutput[] = [
      {
        role: "valuation",
        signal: "BUY",
        conviction: 7,
        thesis: "",
        evidence: [
          { label: "P/E", value: 25, provenance: { source: "fetched" } },
        ],
      },
      {
        role: "momentum",
        signal: "BUY",
        conviction: 8,
        thesis: "",
        evidence: [
          { label: "RSI", value: 55, provenance: { source: "computed" } },
          { label: "MACD", value: 1.2, provenance: { source: "computed" } },
        ],
      },
    ];

    const evidence = collectEvidence(outputs);
    expect(evidence).toHaveLength(3);
    expect(evidence.map((e) => e.label)).toEqual(["P/E", "RSI", "MACD"]);
  });

  it("returns empty array for outputs with no evidence", () => {
    const outputs: AnalystOutput[] = [
      { role: "a", signal: "HOLD", conviction: 5, thesis: "", evidence: [] },
    ];
    expect(collectEvidence(outputs)).toEqual([]);
  });
});
