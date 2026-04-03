import type { EvidenceRecord } from "./evidence.js";

/** A single validation check result. */
export interface ValidationEntry {
  message: string;
  evidenceLabel?: string;
  detail?: string;
}

/** Result of running all deterministic validation checks. */
export interface ValidationResult {
  passes: ValidationEntry[];
  failures: ValidationEntry[];
  warnings: ValidationEntry[];
}

/** Create an empty validation result. */
export function emptyValidationResult(): ValidationResult {
  return { passes: [], failures: [], warnings: [] };
}

/** Check that market-sensitive evidence records have timestamps. */
export function checkTimestamps(
  evidence: EvidenceRecord[],
  marketSensitiveLabels: Set<string>,
): ValidationEntry[] {
  const warnings: ValidationEntry[] = [];
  for (const record of evidence) {
    if (
      marketSensitiveLabels.has(record.label) &&
      record.provenance.source === "fetched" &&
      !record.provenance.timestamp
    ) {
      warnings.push({
        message: `Market-sensitive value '${record.label}' has no timestamp`,
        evidenceLabel: record.label,
      });
    }
  }
  return warnings;
}

/** Check that options expiry dates are in the future. */
export function checkOptionsExpiries(
  evidence: EvidenceRecord[],
  today: string,
): ValidationEntry[] {
  const failures: ValidationEntry[] = [];
  for (const record of evidence) {
    if (
      record.label.toLowerCase().includes("expir") &&
      typeof record.value === "string" &&
      record.value < today
    ) {
      failures.push({
        message: `Options expiry ${record.value} is in the past`,
        evidenceLabel: record.label,
        detail: `Today is ${today}`,
      });
    }
  }
  return failures;
}

/** Check that all required fields have evidence records. */
export function checkRequiredFields(
  evidence: EvidenceRecord[],
  requiredLabels: string[],
): ValidationEntry[] {
  const present = new Set(evidence.map((e) => e.label));
  const failures: ValidationEntry[] = [];
  for (const label of requiredLabels) {
    if (!present.has(label)) {
      failures.push({
        message: `Required field '${label}' has no evidence record`,
        evidenceLabel: label,
      });
    }
  }
  return failures;
}

/** Default market-sensitive labels. */
export const DEFAULT_MARKET_SENSITIVE_LABELS = new Set([
  "Stock Price",
  "Volume",
  "Market Cap",
  "52-Week High",
  "52-Week Low",
  "Bid",
  "Ask",
  "Day High",
  "Day Low",
  "Open",
  "Previous Close",
  "Crypto Price",
  "Crypto Volume",
]);

/** Configuration for the runtime validator. */
export interface ValidatorConfig {
  marketSensitiveLabels?: Set<string>;
  requiredFields?: string[];
  toolResults?: Map<string, number>;
  today?: string;
}

/**
 * Orchestrates all deterministic validation checks on evidence records.
 * Runs before LLM-based validation.
 */
export class RuntimeValidator {
  private readonly config: ValidatorConfig;

  constructor(config: ValidatorConfig = {}) {
    this.config = config;
  }

  /** Run all validation checks and return a combined result. */
  validate(evidence: EvidenceRecord[]): ValidationResult {
    const result = emptyValidationResult();

    // Timestamp checks
    const timestampWarnings = checkTimestamps(
      evidence,
      this.config.marketSensitiveLabels ?? DEFAULT_MARKET_SENSITIVE_LABELS,
    );
    result.warnings.push(...timestampWarnings);

    // Options expiry checks
    const today = this.config.today ?? new Date().toISOString().slice(0, 10);
    const expiryFailures = checkOptionsExpiries(evidence, today);
    result.failures.push(...expiryFailures);

    // Required field checks
    if (this.config.requiredFields) {
      const fieldFailures = checkRequiredFields(evidence, this.config.requiredFields);
      result.failures.push(...fieldFailures);
    }

    // Number match checks
    if (this.config.toolResults) {
      const numberEntries = checkNumberMatch(evidence, this.config.toolResults);
      for (const entry of numberEntries) {
        if ((entry as any).type === "pass") {
          result.passes.push(entry);
        } else {
          result.failures.push(entry);
        }
      }
    }

    return result;
  }

  /** Format validation results as a summary string for the LLM validation prompt. */
  formatForLLM(result: ValidationResult): string {
    const lines: string[] = ["## Deterministic Validation Results"];

    if (result.failures.length > 0) {
      lines.push(`\n### Failures (${result.failures.length})`);
      for (const f of result.failures) {
        lines.push(`- ${f.message}`);
      }
    }

    if (result.warnings.length > 0) {
      lines.push(`\n### Warnings (${result.warnings.length})`);
      for (const w of result.warnings) {
        lines.push(`- ${w.message}`);
      }
    }

    if (result.passes.length > 0) {
      lines.push(`\n### Verified (${result.passes.length})`);
      for (const p of result.passes) {
        lines.push(`- ${p.message}`);
      }
    }

    if (result.failures.length === 0 && result.warnings.length === 0) {
      lines.push("\nAll deterministic checks passed.");
    }

    return lines.join("\n");
  }
}

/** Check that evidence values match expected tool result values. */
export function checkNumberMatch(
  evidence: EvidenceRecord[],
  toolResults: Map<string, number>,
): ValidationEntry[] {
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
