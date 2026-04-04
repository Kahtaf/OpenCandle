import { describe, it, expect } from "vitest";
import { parseDebateOutput, isAnalystSplit } from "../../../src/analysts/contracts.js";
import type { AnalystOutput } from "../../../src/runtime/workflow-types.js";

describe("parseDebateOutput", () => {
  it("parses well-formed bull output", () => {
    const text = `The company shows strong fundamentals across multiple dimensions.

BULL THESIS: Strong FCF growth supports 25% upside.
KEY RISK TO THIS THESIS: Revenue deceleration below 5% YoY.`;

    const result = parseDebateOutput("bull", text);
    expect(result.side).toBe("bull");
    expect(result.thesis).toBe("Strong FCF growth supports 25% upside.");
    expect(result.keyRisk).toBe("Revenue deceleration below 5% YoY.");
    expect(result.concessions).toEqual([]);
    expect(result.remainingConviction).toBe(0);
    expect(result.rawText).toBe(text);
  });

  it("parses well-formed bear output", () => {
    const text = `The bull case has significant flaws.

BEAR THESIS: IV is elevated and revenue is decelerating.
WHAT WOULD CHANGE MY MIND: FCF margin expansion above 30%.`;

    const result = parseDebateOutput("bear", text);
    expect(result.side).toBe("bear");
    expect(result.thesis).toBe("IV is elevated and revenue is decelerating.");
    expect(result.keyRisk).toBe("FCF margin expansion above 30%.");
    expect(result.concessions).toEqual([]);
    expect(result.remainingConviction).toBe(0);
  });

  it("parses rebuttal with concessions", () => {
    const text = `The bear raises valid points but the thesis holds.

CONCESSIONS:
- Revenue deceleration is real
- IV is elevated

REMAINING CONVICTION: 7`;

    const result = parseDebateOutput("bull", text);
    expect(result.concessions).toEqual(["Revenue deceleration is real", "IV is elevated"]);
    expect(result.remainingConviction).toBe(7);
  });

  it("detects rebuttal skipped — em dash variant", () => {
    const result = parseDebateOutput("bull", "REBUTTAL SKIPPED — consensus reached.");
    expect(result.thesis).toBe("");
    expect(result.concessions).toEqual([]);
    expect(result.remainingConviction).toBe(0);
    expect(result.rawText).toContain("REBUTTAL SKIPPED");
  });

  it("detects rebuttal skipped — lowercase", () => {
    const result = parseDebateOutput("bull", "Rebuttal skipped.");
    expect(result.thesis).toBe("");
    expect(result.concessions).toEqual([]);
  });

  it("detects rebuttal skipped — hyphen variant", () => {
    const result = parseDebateOutput("bull", "REBUTTAL SKIPPED - consensus");
    expect(result.thesis).toBe("");
    expect(result.concessions).toEqual([]);
  });

  it("falls back gracefully on malformed output", () => {
    const text = "This response has no expected markers at all.";
    const result = parseDebateOutput("bull", text);
    expect(result.thesis).toBe("");
    expect(result.keyRisk).toBe("");
    expect(result.concessions).toEqual([]);
    expect(result.remainingConviction).toBe(0);
    expect(result.rawText).toBe(text);
  });
});

describe("isAnalystSplit", () => {
  function makeOutput(signal: "BUY" | "HOLD" | "SELL"): AnalystOutput {
    return { role: "test", signal, conviction: 5, thesis: "", evidence: [] };
  }

  it("returns false for consensus (all BUY)", () => {
    const outputs = [makeOutput("BUY"), makeOutput("BUY"), makeOutput("BUY")];
    expect(isAnalystSplit(outputs)).toBe(false);
  });

  it("returns false for consensus (BUY+HOLD)", () => {
    const outputs = [makeOutput("BUY"), makeOutput("HOLD"), makeOutput("BUY")];
    expect(isAnalystSplit(outputs)).toBe(false);
  });

  it("returns true for split (BUY+SELL)", () => {
    const outputs = [makeOutput("BUY"), makeOutput("SELL"), makeOutput("HOLD")];
    expect(isAnalystSplit(outputs)).toBe(true);
  });

  it("returns false for edge case (all HOLD)", () => {
    const outputs = [makeOutput("HOLD"), makeOutput("HOLD"), makeOutput("HOLD")];
    expect(isAnalystSplit(outputs)).toBe(false);
  });
});
