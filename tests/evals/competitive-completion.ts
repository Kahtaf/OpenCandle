import type { CompletionReportCase } from "./completion-report.js";
import type { FinalAnswerAssertionResult } from "./prompt-policy-assertions.js";

/**
 * Builds the required completion case for a frozen competitive prompt.
 *
 * Only the manifest's required hard assertions participate here; optional
 * judge (non-deterministic) assertions stay separate and can never make the
 * case pass or fail. Every required assertion name must be unique and must be
 * present exactly once in `results` under the same name. A frozen prompt
 * passes only when every matched result is deterministic and passed. Missing,
 * extra, duplicate, or malformed assertions fail, and a required assertion
 * with no deterministic checker fails even when a sibling passed — an unknown
 * checker cannot hide behind a passing one.
 */
export function completionCaseForPrompt(
  id: string,
  requiredAssertions: readonly string[],
  results: readonly FinalAnswerAssertionResult[],
): CompletionReportCase {
  if (requiredAssertions.length === 0) {
    return fail(id, "no required hard assertions configured for frozen prompt");
  }
  const expectedNames = new Set<string>();
  for (const name of requiredAssertions) {
    if (typeof name !== "string" || name.trim() === "") {
      return fail(id, "malformed required assertion name");
    }
    if (expectedNames.has(name)) {
      return fail(id, `duplicate required assertion name: ${name}`);
    }
    expectedNames.add(name);
  }
  if (results.length !== requiredAssertions.length) {
    return fail(
      id,
      `hard assertion result count ${results.length} does not match ${requiredAssertions.length} configured required assertion(s)`,
    );
  }
  const resultNames = new Set<string>();
  for (const result of results) {
    if (typeof result.assertion !== "string" || result.assertion.trim() === "") {
      return fail(id, "malformed hard assertion result name");
    }
    if (resultNames.has(result.assertion)) {
      return fail(id, `duplicate hard assertion result name: ${result.assertion}`);
    }
    resultNames.add(result.assertion);
  }
  const missing = [...expectedNames].filter((name) => !resultNames.has(name));
  const unexpected = [...resultNames].filter((name) => !expectedNames.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    return fail(
      id,
      `hard assertion results do not match the required assertions (missing: ${
        missing.join(", ") || "none"
      }; unexpected: ${unexpected.join(", ") || "none"})`,
    );
  }
  const withoutChecker = results.filter((result) => !result.deterministic);
  if (withoutChecker.length > 0) {
    return fail(
      id,
      `required assertion(s) have no deterministic checker: ${withoutChecker
        .map((result) => result.assertion)
        .join("; ")}`,
    );
  }
  const failed = results.filter((result) => !result.passed);
  if (failed.length > 0) {
    return fail(
      id,
      `deterministic hard assertion(s) failed: ${failed
        .map((result) => result.assertion)
        .join("; ")}`,
    );
  }
  return { id, status: "passed" };
}

function fail(id: string, reason: string): CompletionReportCase {
  return { id, status: "failed", reason: truncateReason(reason) };
}

function truncateReason(reason: string): string {
  const collapsed = reason.replace(/\s+/g, " ").trim();
  return collapsed.length > 900 ? `${collapsed.slice(0, 899)}…` : collapsed;
}
