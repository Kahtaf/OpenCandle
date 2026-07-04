import type { EvidenceRecord } from "./evidence.js";

/**
 * Observe-only numeric-claim extraction for synthesis validation (I3).
 *
 * These heuristics bind numbers in analyst prose to tool-result metrics so
 * checkNumberMatch has claims to verify. They are deliberately conservative:
 * every false mismatch poisons the false-positive-rate data that gates the
 * answer-receipts direction (I8 phase 1), so a missed claim is cheaper than
 * a wrong one.
 */

/** Flatten numeric values from a tool-evidence digest preview into labeled tool results. */
export function collectToolNumbers(record: EvidenceRecord, toolResults: Map<string, number>): void {
  if (!isPlainObject(record.value)) return;
  const tool = typeof record.value.tool === "string" ? record.value.tool : undefined;
  const digest = isPlainObject(record.value.resultDigest) ? record.value.resultDigest : undefined;
  const preview = typeof digest?.preview === "string" ? digest.preview : undefined;
  if (!tool || !preview) return;
  const parsed = parseMaybeJson(preview);
  if (!parsed) return;
  for (const [path, value] of flattenNumericValues(parsed)) {
    toolResults.set(`${tool}.${path}`, value);
  }
}

/**
 * Extract numeric claims from step text for metrics present in toolResults.
 *
 * Binding rules (each guards against a live-observed false-positive class):
 * - the metric term must appear as a whole word ("opening" is not `open`)
 * - the number must follow within a short window (no cross-sentence binding)
 * - thousands separators parse as one number ("129,935,067" is not 129)
 * - a prose value that rounds to the tool result is normalized onto it
 *   ("197.14" claims the tool's 197.13999938964844, not a mismatch)
 */
export function extractNumericClaims(
  text: string,
  toolResults: Map<string, number>,
): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  for (const [label, expected] of toolResults) {
    const metric = label.split(".").at(-1);
    if (!metric) continue;
    const pattern = new RegExp(
      `\\b${escapeRegex(metric)}\\b[^\\d-]{0,30}(-?\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?)`,
      "i",
    );
    const match = text.match(pattern);
    if (!match) continue;
    const value = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    records.push({
      label,
      value: isRoundingOf(value, expected) ? expected : value,
      provenance: { source: "computed" },
    });
  }
  return records;
}

/** True when `claim` is `expected` rounded to the claim's own precision. */
function isRoundingOf(claim: number, expected: number): boolean {
  if (claim === expected) return true;
  const decimals = countDecimals(claim);
  const factor = 10 ** decimals;
  return Math.round(expected * factor) / factor === claim;
}

function countDecimals(value: number): number {
  const text = String(value);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

function flattenNumericValues(
  value: Record<string, unknown>,
  prefix = "",
): Array<[string, number]> {
  const values: Array<[string, number]> = [];
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === "number" && Number.isFinite(item)) {
      values.push([path, item]);
    } else if (isPlainObject(item)) {
      values.push(...flattenNumericValues(item, path));
    }
  }
  return values;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseMaybeJson(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
