import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { ProviderResult } from "../../../src/runtime/evidence.js";
import {
  classifyToolOutcome,
  isProviderOk,
  toEvidenceRecord,
} from "../../../src/runtime/evidence.js";
import { captureToolEvidence } from "../../../src/runtime/prompt-step.js";

describe("isProviderOk", () => {
  it("returns true for ok results", () => {
    const result: ProviderResult<number> = {
      status: "ok",
      data: 42,
      timestamp: "2026-04-02T14:00:00Z",
    };
    expect(isProviderOk(result)).toBe(true);
  });

  it("returns false for unavailable results", () => {
    const result: ProviderResult<number> = {
      status: "unavailable",
      reason: "rate_limited",
      provider: "alpha-vantage",
    };
    expect(isProviderOk(result)).toBe(false);
  });
});

describe("captureToolEvidence", () => {
  it("copies freshness from tool details and timestamps provenance from provider data time", () => {
    const freshness = {
      fetchedAt: "2026-07-05T19:00:00.000Z",
      providerDataAt: "2026-07-02T20:00:00.000Z",
      cacheStatus: "live",
      marketSession: "closed_weekend",
      isStaleForSession: false,
    };
    const entries = [
      {
        type: "message",
        id: "assistant-1",
        parentId: null,
        timestamp: "2026-07-05T19:00:00.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "tool-1",
              name: "get_stock_quote",
              arguments: { symbol: "AAPL" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "tool-1-result",
        parentId: "assistant-1",
        timestamp: "2026-07-05T19:00:01.000Z",
        message: {
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "get_stock_quote",
          details: { symbol: "AAPL", price: 178.72, freshness },
        },
      },
    ] as unknown as SessionEntry[];

    const [record] = captureToolEvidence(entries);

    expect(record.value).toMatchObject({ freshness });
    expect(record.provenance.timestamp).toBe("2026-07-02T20:00:00.000Z");
  });

  it("classifies envelope payloads by their usable details", () => {
    expect(classifyToolOutcome({ content: [], details: { price: 178.72 } }, false)).toBe("ok");
    expect(classifyToolOutcome({ content: [], details: null }, false)).toBe("unavailable");
    expect(classifyToolOutcome({ content: [], details: [] }, false)).toBe("unavailable");
    expect(classifyToolOutcome({ content: [], details: {} }, false)).toBe("unavailable");
    expect(classifyToolOutcome({ content: [], details: { price: 178.72 } }, true)).toBe("error");
  });

  it("requires a price comparison to carry actual aligned series", () => {
    const emptySeries = {
      content: [],
      details: {
        range: "1y",
        interval: "1d",
        baseDate: "",
        series: [],
        unavailableSymbols: ["VOO", "BND"],
        freshness: {},
      },
    };
    const usableSeries = {
      content: [],
      details: {
        range: "1y",
        interval: "1d",
        baseDate: "2026-01-02",
        series: [{ symbol: "VOO", bars: [{ date: "2026-01-02", close: 470 }] }],
        unavailableSymbols: [],
        freshness: {},
      },
    };

    expect(classifyToolOutcome(emptySeries, false, "get_price_comparison")).toBe("unavailable");
    expect(classifyToolOutcome(usableSeries, false, "get_price_comparison")).toBe("ok");
    // The legacy no-envelope acceptance must not qualify a comparison.
    expect(classifyToolOutcome({ range: "1y", series: [] }, false, "get_price_comparison")).toBe(
      "unavailable",
    );
    expect(
      classifyToolOutcome(
        { range: "1y", series: [{ symbol: "VOO" }] },
        false,
        "get_price_comparison",
      ),
    ).toBe("unavailable");
  });

  it("classifies captured tool results without usable details as unavailable", () => {
    const entries = [
      {
        type: "message",
        id: "assistant-outcomes",
        parentId: null,
        timestamp: "2026-07-05T19:00:00.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "ok", name: "get_stock_quote", arguments: {} },
            { type: "toolCall", id: "null", name: "get_stock_quote", arguments: {} },
            { type: "toolCall", id: "empty", name: "get_stock_history", arguments: {} },
            { type: "toolCall", id: "error", name: "get_stock_quote", arguments: {} },
          ],
        },
      },
      {
        type: "message",
        id: "res-ok",
        parentId: "assistant-outcomes",
        timestamp: "2026-07-05T19:00:01.000Z",
        message: {
          role: "toolResult",
          toolCallId: "ok",
          toolName: "get_stock_quote",
          details: { symbol: "VOO", price: 474.96 },
          content: [],
        },
      },
      {
        type: "message",
        id: "res-null",
        parentId: "assistant-outcomes",
        timestamp: "2026-07-05T19:00:02.000Z",
        message: {
          role: "toolResult",
          toolCallId: "null",
          toolName: "get_stock_quote",
          details: null,
          content: [{ type: "text", text: "unavailable" }],
        },
      },
      {
        type: "message",
        id: "res-empty",
        parentId: "assistant-outcomes",
        timestamp: "2026-07-05T19:00:03.000Z",
        message: {
          role: "toolResult",
          toolCallId: "empty",
          toolName: "get_stock_history",
          details: [],
          content: [{ type: "text", text: "unavailable" }],
        },
      },
      {
        type: "message",
        id: "res-error",
        parentId: "assistant-outcomes",
        timestamp: "2026-07-05T19:00:04.000Z",
        message: {
          role: "toolResult",
          toolCallId: "error",
          toolName: "get_stock_quote",
          details: { symbol: "VOO", price: 474.96 },
          content: [{ type: "text", text: "failed" }],
          isError: true,
        },
      },
    ] as unknown as SessionEntry[];

    const outcomes = captureToolEvidence(entries).map(
      (record) => (record.value as { outcome?: string }).outcome,
    );

    expect(outcomes).toEqual(["ok", "unavailable", "unavailable", "error"]);
  });
});

describe("toEvidenceRecord", () => {
  it("converts ok result to fetched evidence", () => {
    const result: ProviderResult<{ price: number }> = {
      status: "ok",
      data: { price: 185.5 },
      timestamp: "2026-04-02T14:30:00Z",
    };
    const record = toEvidenceRecord("Stock Price", result);

    expect(record.label).toBe("Stock Price");
    expect(record.value).toEqual({ price: 185.5 });
    expect(record.provenance.source).toBe("fetched");
    expect(record.provenance.timestamp).toBe("2026-04-02T14:30:00Z");
  });

  it("converts ok result with providerId", () => {
    const result: ProviderResult<number> = {
      status: "ok",
      data: 42,
      timestamp: "2026-04-02T14:30:00Z",
    };
    const record = toEvidenceRecord("Value", result, "yahoo");

    expect(record.provenance.source).toBe("fetched");
    expect(record.provenance.provider).toBe("yahoo");
  });

  it("converts stale ok result to stale_cache evidence", () => {
    const result: ProviderResult<{ price: number }> = {
      status: "ok",
      data: { price: 180.0 },
      timestamp: "2026-04-02T12:00:00Z",
      stale: true,
    };
    const record = toEvidenceRecord("Stock Price", result, "yahoo");

    expect(record.provenance.source).toBe("stale_cache");
    expect(record.provenance.timestamp).toBe("2026-04-02T12:00:00Z");
    expect(record.provenance.provider).toBe("yahoo");
    expect(record.provenance.confidence).toBe(0.5);
  });

  it("converts unavailable result to unavailable evidence", () => {
    const result: ProviderResult<unknown> = {
      status: "unavailable",
      reason: "network_error",
      provider: "yahoo-finance",
    };
    const record = toEvidenceRecord("Stock Price", result);

    expect(record.label).toBe("Stock Price");
    expect(record.value).toBeNull();
    expect(record.provenance.source).toBe("unavailable");
    expect(record.provenance.reason).toBe("network_error");
    expect(record.provenance.provider).toBe("yahoo-finance");
  });
});
