import { describe, it, expect } from "vitest";
import { RuntimeValidator } from "../../../src/runtime/validation.js";
import type { EvidenceRecord } from "../../../src/runtime/evidence.js";

describe("RuntimeValidator", () => {
  it("passes when all checks succeed", () => {
    const validator = new RuntimeValidator({
      today: "2026-04-02",
      requiredFields: ["Stock Price"],
      toolResults: new Map([["Stock Price", 185.5]]),
    });

    const evidence: EvidenceRecord[] = [
      {
        label: "Stock Price",
        value: 185.5,
        provenance: { source: "fetched", timestamp: "2026-04-02T14:00:00Z" },
      },
    ];

    const result = validator.validate(evidence);
    expect(result.failures).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.passes.length).toBeGreaterThan(0);
  });

  it("warns on missing timestamps for market-sensitive values", () => {
    const validator = new RuntimeValidator({
      marketSensitiveLabels: new Set(["Stock Price"]),
    });

    const evidence: EvidenceRecord[] = [
      {
        label: "Stock Price",
        value: 185.5,
        provenance: { source: "fetched" },
      },
    ];

    const result = validator.validate(evidence);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain("no timestamp");
  });

  it("fails on past options expiries", () => {
    const validator = new RuntimeValidator({ today: "2026-04-02" });

    const evidence: EvidenceRecord[] = [
      {
        label: "Options Expiry",
        value: "2026-03-15",
        provenance: { source: "fetched" },
      },
    ];

    const result = validator.validate(evidence);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].message).toContain("in the past");
  });

  it("fails on missing required fields", () => {
    const validator = new RuntimeValidator({
      requiredFields: ["Stock Price", "P/E Ratio"],
    });

    const evidence: EvidenceRecord[] = [
      {
        label: "Stock Price",
        value: 185.5,
        provenance: { source: "fetched", timestamp: "2026-04-02T14:00:00Z" },
      },
    ];

    const result = validator.validate(evidence);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].message).toContain("P/E Ratio");
  });

  it("fails on number mismatches", () => {
    const validator = new RuntimeValidator({
      toolResults: new Map([["Revenue", 45_000_000_000]]),
    });

    const evidence: EvidenceRecord[] = [
      {
        label: "Revenue",
        value: 50_000_000_000,
        provenance: { source: "fetched" },
      },
    ];

    const result = validator.validate(evidence);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].message).toContain("mismatch");
  });

  it("formats results for LLM", () => {
    const validator = new RuntimeValidator({ today: "2026-04-02" });

    const evidence: EvidenceRecord[] = [
      {
        label: "Options Expiry",
        value: "2026-03-15",
        provenance: { source: "fetched" },
      },
    ];

    const result = validator.validate(evidence);
    const formatted = validator.formatForLLM(result);

    expect(formatted).toContain("Deterministic Validation Results");
    expect(formatted).toContain("Failures");
    expect(formatted).toContain("in the past");
  });

  it("formats clean results for LLM", () => {
    const validator = new RuntimeValidator();
    const result = validator.validate([]);
    const formatted = validator.formatForLLM(result);
    expect(formatted).toContain("All deterministic checks passed");
  });

  it("accepts explicitly unavailable fields for required check", () => {
    const validator = new RuntimeValidator({
      requiredFields: ["Stock Price", "Market Cap"],
    });

    const evidence: EvidenceRecord[] = [
      {
        label: "Stock Price",
        value: 185.5,
        provenance: { source: "fetched", timestamp: "2026-04-02T14:00:00Z" },
      },
      {
        label: "Market Cap",
        value: null,
        provenance: { source: "unavailable", reason: "not_covered" },
      },
    ];

    const result = validator.validate(evidence);
    // Market Cap is present (as unavailable), so no failure for it
    expect(result.failures).toHaveLength(0);
  });
});
