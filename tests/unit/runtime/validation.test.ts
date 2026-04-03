import { describe, it, expect } from "vitest";
import {
  checkTimestamps,
  checkOptionsExpiries,
  checkRequiredFields,
  checkNumberMatch,
  emptyValidationResult,
} from "../../../src/runtime/validation.js";
import type { EvidenceRecord } from "../../../src/runtime/evidence.js";

describe("emptyValidationResult", () => {
  it("returns empty arrays", () => {
    const result = emptyValidationResult();
    expect(result.passes).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("checkTimestamps", () => {
  const marketLabels = new Set(["Stock Price", "Volume"]);

  it("warns when market-sensitive fetched value has no timestamp", () => {
    const evidence: EvidenceRecord[] = [
      {
        label: "Stock Price",
        value: 185.5,
        provenance: { source: "fetched" },
      },
    ];
    const warnings = checkTimestamps(evidence, marketLabels);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("Stock Price");
    expect(warnings[0].message).toContain("no timestamp");
  });

  it("does not warn when timestamp is present", () => {
    const evidence: EvidenceRecord[] = [
      {
        label: "Stock Price",
        value: 185.5,
        provenance: { source: "fetched", timestamp: "2026-04-02T14:00:00Z" },
      },
    ];
    const warnings = checkTimestamps(evidence, marketLabels);
    expect(warnings).toHaveLength(0);
  });

  it("does not warn for non-market-sensitive labels", () => {
    const evidence: EvidenceRecord[] = [
      {
        label: "Company Name",
        value: "Apple Inc.",
        provenance: { source: "fetched" },
      },
    ];
    const warnings = checkTimestamps(evidence, marketLabels);
    expect(warnings).toHaveLength(0);
  });

  it("does not warn for non-fetched sources", () => {
    const evidence: EvidenceRecord[] = [
      {
        label: "Stock Price",
        value: 185.5,
        provenance: { source: "user" },
      },
    ];
    const warnings = checkTimestamps(evidence, marketLabels);
    expect(warnings).toHaveLength(0);
  });
});

describe("checkOptionsExpiries", () => {
  const today = "2026-04-02";

  it("fails for past expiry dates", () => {
    const evidence: EvidenceRecord[] = [
      {
        label: "Options Expiry",
        value: "2026-03-15",
        provenance: { source: "fetched" },
      },
    ];
    const failures = checkOptionsExpiries(evidence, today);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain("2026-03-15");
    expect(failures[0].message).toContain("in the past");
  });

  it("passes for future expiry dates", () => {
    const evidence: EvidenceRecord[] = [
      {
        label: "Options Expiry",
        value: "2026-05-16",
        provenance: { source: "fetched" },
      },
    ];
    const failures = checkOptionsExpiries(evidence, today);
    expect(failures).toHaveLength(0);
  });

  it("ignores non-expiry labels", () => {
    const evidence: EvidenceRecord[] = [
      {
        label: "P/E Ratio",
        value: "2026-03-15",
        provenance: { source: "fetched" },
      },
    ];
    const failures = checkOptionsExpiries(evidence, today);
    expect(failures).toHaveLength(0);
  });
});

describe("checkRequiredFields", () => {
  it("fails for missing required fields", () => {
    const evidence: EvidenceRecord[] = [
      {
        label: "Stock Price",
        value: 185.5,
        provenance: { source: "fetched" },
      },
    ];
    const failures = checkRequiredFields(evidence, ["Stock Price", "Market Cap"]);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain("Market Cap");
  });

  it("passes when explicitly unavailable", () => {
    const evidence: EvidenceRecord[] = [
      {
        label: "Stock Price",
        value: 185.5,
        provenance: { source: "fetched" },
      },
      {
        label: "Market Cap",
        value: null,
        provenance: { source: "unavailable", reason: "not_covered" },
      },
    ];
    const failures = checkRequiredFields(evidence, ["Stock Price", "Market Cap"]);
    expect(failures).toHaveLength(0);
  });

  it("passes when all required fields present", () => {
    const evidence: EvidenceRecord[] = [
      { label: "A", value: 1, provenance: { source: "fetched" } },
      { label: "B", value: 2, provenance: { source: "fetched" } },
    ];
    const failures = checkRequiredFields(evidence, ["A", "B"]);
    expect(failures).toHaveLength(0);
  });
});

describe("checkNumberMatch", () => {
  it("passes when evidence matches tool result", () => {
    const evidence: EvidenceRecord[] = [
      { label: "P/E Ratio", value: 25.3, provenance: { source: "fetched" } },
    ];
    const toolResults = new Map([["P/E Ratio", 25.3]]);
    const entries = checkNumberMatch(evidence, toolResults);
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toContain("matches");
  });

  it("fails when evidence does not match tool result", () => {
    const evidence: EvidenceRecord[] = [
      { label: "Revenue", value: 50_000_000_000, provenance: { source: "fetched" } },
    ];
    const toolResults = new Map([["Revenue", 45_000_000_000]]);
    const entries = checkNumberMatch(evidence, toolResults);
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toContain("mismatch");
  });

  it("ignores non-numeric evidence values", () => {
    const evidence: EvidenceRecord[] = [
      { label: "Sector", value: "Technology", provenance: { source: "fetched" } },
    ];
    const toolResults = new Map<string, number>();
    const entries = checkNumberMatch(evidence, toolResults);
    expect(entries).toHaveLength(0);
  });
});
