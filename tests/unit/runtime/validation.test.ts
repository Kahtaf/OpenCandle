import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "../../../src/runtime/evidence.js";
import { checkNumberMatch } from "../../../src/runtime/validation.js";

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
