import type { EvidenceRecord } from "./evidence.js";

/** A single validation check result. */
export interface ValidationEntry {
  message: string;
  evidenceLabel?: string;
  detail?: string;
}

/** Check that evidence values match expected tool result values. */
export function checkNumberMatch(
  evidence: EvidenceRecord[],
  toolResults: Map<string, number>,
): Array<ValidationEntry & { type: "pass" | "failure" }> {
  const results: (ValidationEntry & { type: "pass" | "failure" })[] = [];
  for (const record of evidence) {
    if (typeof record.value !== "number") continue;
    const expected = toolResults.get(record.label);
    if (expected === undefined) continue;
    if (record.value === expected) {
      results.push({
        type: "pass",
        message: `${record.label}: ${record.value} matches tool result`,
        evidenceLabel: record.label,
      });
    } else {
      results.push({
        type: "failure",
        message: `${record.label} mismatch: evidence says ${record.value}, tool returned ${expected}`,
        evidenceLabel: record.label,
      });
    }
  }
  return results;
}
