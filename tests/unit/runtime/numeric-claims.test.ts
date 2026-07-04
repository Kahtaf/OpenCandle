import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "../../../src/runtime/evidence.js";
import { collectToolNumbers, extractNumericClaims } from "../../../src/runtime/numeric-claims.js";

function toolRecord(tool: string, resultPreview: unknown): EvidenceRecord {
  return {
    label: tool,
    value: {
      tool,
      args: "{}",
      resultDigest: { preview: JSON.stringify(resultPreview), totalLength: 100 },
      startedAt: "2026-07-04T00:00:00Z",
      completedAt: "2026-07-04T00:00:01Z",
    },
    provenance: { source: "fetched" },
  } as EvidenceRecord;
}

describe("collectToolNumbers", () => {
  it("flattens numeric values from digest previews into labeled tool results", () => {
    const toolResults = new Map<string, number>();
    collectToolNumbers(
      toolRecord("get_stock_quote", { details: { open: 197.14, volume: 129935067 } }),
      toolResults,
    );
    expect(toolResults.get("get_stock_quote.details.open")).toBe(197.14);
    expect(toolResults.get("get_stock_quote.details.volume")).toBe(129935067);
  });
});

describe("extractNumericClaims", () => {
  const toolResults = new Map<string, number>([
    ["get_stock_quote.details.open", 197.13999938964844],
    ["get_stock_quote.details.high", 200.055],
    ["get_stock_quote.details.volume", 129935067],
    ["get_fear_greed.details.value", 22],
  ]);

  it("does not bind a metric term inside a larger word", () => {
    // "opening" must not produce an `open` claim of 60.
    const claims = extractNumericClaims(
      "Momentum is opening the door to 60% upside this quarter.",
      toolResults,
    );
    expect(claims.find((c) => c.label.endsWith(".open"))).toBeUndefined();
  });

  it("does not bind a number far away from the metric term", () => {
    // The old unbounded window bound `high ... someday ... 10`.
    const claims = extractNumericClaims(
      "The high conviction view is that over a multi-year horizon the business compounds and the stock could reach 10 times earnings.",
      toolResults,
    );
    expect(claims.find((c) => c.label.endsWith(".high"))).toBeUndefined();
  });

  it("parses thousands separators instead of truncating at the first comma", () => {
    const claims = extractNumericClaims("Today's volume was 129,935,067 shares.", toolResults);
    const volume = claims.find((c) => c.label.endsWith(".volume"));
    expect(volume?.value).toBe(129935067);
  });

  it("normalizes rounded prose values onto the tool result they round to", () => {
    // "197.14" is the tool's 197.13999938964844 rounded for prose; treating
    // it as a mismatch poisons the validator's false-positive data.
    const claims = extractNumericClaims("The open was 197.14 today.", toolResults);
    const open = claims.find((c) => c.label.endsWith(".open"));
    expect(open?.value).toBe(197.13999938964844);
  });

  it("keeps genuinely mismatched values unnormalized", () => {
    const claims = extractNumericClaims("The fear and greed value hit 95.", toolResults);
    const fg = claims.find((c) => c.label.endsWith(".value"));
    expect(fg?.value).toBe(95);
  });
});
