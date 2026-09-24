/**
 * Type declarations for `scripts/release-evidence.mjs`.
 *
 * The implementation stays runtime JavaScript (a release helper shared by the
 * eval front door and the release-evidence tests); this file describes only its
 * public surface and carries no runtime code.
 */

export const EVIDENCE_SCHEMA_VERSION: 1;

export const REQUIRED_SUITE_IDS: readonly ["router-live", "cases", "product", "competitive:frozen"];

/** Candidate identity produced by {@link fingerprintCandidate}. */
export interface ReleaseEvidenceCandidate {
  commit: string;
  sourceDigest: string;
  lockDigest: string;
  policyDigest: string;
}

export interface ReleaseEvidenceValidationOptions {
  /** Expected candidate identity; when supplied it must match exactly. */
  candidate?: ReleaseEvidenceCandidate;
  /** Validation clock: epoch millis, timestamp string, or Date. Defaults to now. */
  now?: number | string | Date;
  /** Maximum evidence age in hours. Defaults to the module's own default. */
  maxAgeHours?: number;
  /** Caller's independent per-suite expected case ids; required to be complete. */
  expectedCaseIds?: Record<string, string[]>;
}

export interface ReleaseEvidenceValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate an untrusted release evidence record against a candidate identity.
 * Returns `{ valid, errors }` and never throws on malformed input.
 */
export function validateReleaseEvidence(
  evidence: unknown,
  options?: ReleaseEvidenceValidationOptions,
): ReleaseEvidenceValidationResult;

/**
 * Fingerprint a candidate release tree. Requires a clean working tree (ignored
 * artifacts are allowed) and fails closed on a tracked credential-shaped file.
 */
export function fingerprintCandidate(root: string): ReleaseEvidenceCandidate;
