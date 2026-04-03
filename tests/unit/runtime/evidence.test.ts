import { describe, it, expect } from "vitest";
import {
  isProviderOk,
  toEvidenceRecord,
} from "../../../src/runtime/evidence.js";
import type { ProviderResult } from "../../../src/runtime/evidence.js";

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
