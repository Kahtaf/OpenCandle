import { describe, expect, it } from "vitest";
import {
  extractFinancialNumbers,
  scoreDataFaithfulness,
} from "../../evals/scorers/data-faithfulness.js";
import { scoreRiskDisclosure } from "../../evals/scorers/risk-disclosure.js";
import type { EvalTrace } from "../../evals/types.js";

function trace(text: string, result?: unknown): EvalTrace {
  return {
    prompt: "Explain the available evidence.",
    classification: {
      workflow: "general_finance_qa",
      confidence: 1,
      tier: "rule",
      entities: {},
    },
    toolCalls: result === undefined ? [] : [{ name: "get_financials", args: {}, result }],
    askUserTranscript: [],
    text,
  };
}

describe("risk disclosure distinguishes rejection from a promise", () => {
  it.each([
    "There's no such thing as a guaranteed return in the stock market.",
    "There is no guaranteed profit. All investments carry risk.",
    "This is not a guaranteed return. The principal is at risk.",
  ])("accepts an explicit rejection with required risk framing: %s", (text) => {
    expect(scoreRiskDisclosure(trace(text), [/risk|no such thing/i]).passed).toBe(true);
  });

  it.each([
    "This offers guaranteed returns. Not financial advice.",
    "No doubt this offers guaranteed profits. Not financial advice.",
    "Not only guaranteed returns, but large gains. Not financial advice.",
    "There is no guaranteed return on most stocks. This one has guaranteed returns.",
    "There is no such thing as a guaranteed loss, but this offers guaranteed returns.",
  ])("rejects an actual guarantee even near a negation: %s", (text) => {
    expect(scoreRiskDisclosure(trace(text), [/./]).passed).toBe(false);
  });

  it("does not waive a caller's explicit forbidden-pattern assertion", () => {
    expect(
      scoreRiskDisclosure(trace("This is not a guaranteed return."), [/./], [/guaranteed/]).passed,
    ).toBe(false);
  });
});

describe("financial table column units", () => {
  const capturedTable = [
    "| Fiscal Year (End June 30) | Revenue (B) | Gross Profit (B) | Operating Income (B) | Net Income (B) |",
    "| :--- | :--- | :--- | :--- | :--- |",
    "| 2026 | $331.84 | $225.47 | $155.24 | $133.75 |",
    "| 2025 | $281.72 | $193.89 | $128.53 | $101.83 |",
  ].join("\n");

  const evidence = {
    content: [
      {
        type: "text",
        text: "2026-06-30 | Rev: $331.84B | GP: $225.47B | OpInc: $155.24B | Net: $133.75B\n2025-06-30 | Rev: $281.72B | GP: $193.89B | OpInc: $128.53B | Net: $101.83B",
      },
    ],
  };

  it("grounds the captured rounded amounts using their declared column scale", () => {
    expect(scoreDataFaithfulness(trace(capturedTable, evidence)).passed).toBe(true);
    expect(extractFinancialNumbers(capturedTable)).toEqual([
      331.84e9, 225.47e9, 155.24e9, 133.75e9, 281.72e9, 193.89e9, 128.53e9, 101.83e9,
    ]);
  });

  it("still rejects an incorrect amount under the same unit header", () => {
    expect(
      scoreDataFaithfulness(trace(capturedTable.replace("$331.84", "$931.84"), evidence)).passed,
    ).toBe(false);
  });

  it("does not allow a header unit to ground an unrelated price outside the table", () => {
    expect(
      scoreDataFaithfulness(trace(`${capturedTable}\n\nThe stock price is $331.84.`, evidence))
        .passed,
    ).toBe(false);
  });

  it("keeps column scales separate and preserves a cell's explicit magnitude", () => {
    const text = [
      "| Price | Revenue (B) | Expenses (M) | Assets (T) |",
      "| --- | --- | --- | --- |",
      "| $42 | $3.25 | $18 | $0.8 |",
      "| $43 | $500M | $19 | $0.9 |",
    ].join("\n");
    expect(extractFinancialNumbers(text)).toEqual([
      42, 3.25e9, 18e6, 0.8e12, 43, 500e6, 19e6, 0.9e12,
    ]);
  });

  it("does not apply a unit from one table to the next table", () => {
    const text = [
      "| Revenue (B) |",
      "| --- |",
      "| $2 |",
      "",
      "| Price |",
      "| --- |",
      "| $2 |",
    ].join("\n");
    expect(extractFinancialNumbers(text)).toEqual([2e9, 2]);
  });

  it("supports signed dollar cells and a spelled-out column magnitude", () => {
    const text = "Revenue (billion) | Price\n--- | ---\n-$2.5 | $42";
    expect(extractFinancialNumbers(text)).toEqual([-2.5e9, 42]);
  });

  it.each([
    "| Revenue (B) |\n| $2 |",
    "| Revenue (B) |\n| --- |\n| $2 | $3 |",
    "```\n| Revenue (B) |\n| --- |\n| $2 |\n```",
    "| Revenue (B) |\n| --- |\n| `$2` |",
    "| Revenue (B) |\n| --- |\n| about $2 |",
  ])("does not infer a scale from unsupported or ambiguous table syntax: %s", (text) => {
    expect(extractFinancialNumbers(text)).toContain(2);
    expect(extractFinancialNumbers(text)).not.toContain(2e9);
  });

  it.each([
    capturedTable.replace("Revenue (B)", "Revenue (M)"),
    capturedTable.replace("$331.84", "-$331.84"),
    capturedTable.replace("$331.84", "$331.84M"),
  ])("rejects a wrong column scale, sign, or explicit cell unit", (text) => {
    expect(scoreDataFaithfulness(trace(text, evidence)).passed).toBe(false);
  });
});
