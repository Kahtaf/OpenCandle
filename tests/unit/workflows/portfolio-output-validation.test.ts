import { describe, expect, it } from "vitest";
import {
  buildPortfolioRepairPrompt,
  validatePortfolioOutput,
} from "../../../src/workflows/portfolio-output-validation.js";

const constraints = { positionCount: 3, maxSinglePositionPct: 40 };

describe("validatePortfolioOutput", () => {
  it("accepts an exact allocation table", () => {
    expect(
      validatePortfolioOutput(
        `| Symbol | Allocation % | Role |
| --- | ---: | --- |
| AAPL | 35% | Growth |
| JNJ | 35% | Defensive |
| PG | 30% | Staples |`,
        constraints,
      ),
    ).toEqual([]);
  });

  it("reports incorrect count, cap, and arithmetic", () => {
    expect(
      validatePortfolioOutput(
        `| Symbol | Allocation % |
| --- | ---: |
| AAPL | 45% |
| MSFT | 40% |`,
        constraints,
      ),
    ).toEqual([
      "allocation table has 2 positions; expected exactly 3",
      "positions above the 40% cap: AAPL 45%",
      "allocation percentages sum to 85%; expected 100%",
    ]);
  });

  it("rejects duplicate and composite holdings that bypass diversification constraints", () => {
    expect(
      validatePortfolioOutput(
        `| Symbol | Allocation % |
| --- | ---: |
| AAPL | 35% |
| AAPL | 35% |
| MSFT / NVDA | 30% |`,
        constraints,
      ),
    ).toEqual([
      "allocation rows must contain one holding each; composite symbols: MSFT / NVDA",
      "duplicate allocation symbols: AAPL",
    ]);
  });

  it("builds a bounded repair prompt from deterministic failures", () => {
    const prompt = buildPortfolioRepairPrompt(
      ["allocation percentages sum to 90%; expected 100%"],
      { positionCount: 8, maxSinglePositionPct: 15 },
      "stocks_only",
    );

    expect(prompt).toContain("exactly 8 positions");
    expect(prompt).toContain('hard asset scope "stocks_only"');
    expect(prompt).toContain("no position above 15%");
    expect(prompt).toContain("arithmetically sum to 100%");
    expect(prompt).toContain("Do not make new tool calls");
  });
});
