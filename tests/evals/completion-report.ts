import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";

/**
 * Machine-readable completion report for the eval front door.
 *
 * The writer is opt-in: it does nothing unless `OPENCANDLE_EVAL_COMPLETION_PATH`
 * is set, so normal eval runs are unaffected. When configured it atomically
 * writes ONLY the known schema fields below — never credentials, prompts, or
 * raw traces — and refuses to write a report that is structurally malformed.
 */

export const COMPLETION_REPORT_PATH_ENV = "OPENCANDLE_EVAL_COMPLETION_PATH";
export const COMPLETION_REPORT_VERSION = 1;

export type CompletionCaseStatus = "passed" | "failed" | "skipped";

export interface CompletionReportCase {
  id: string;
  status: CompletionCaseStatus;
  reason?: string;
}

export interface CompletionReport {
  version: 1;
  suite: string;
  startedAt: string;
  finishedAt: string;
  cases: CompletionReportCase[];
  exitCode: number;
  settings: Record<string, string>;
}

export class CompletionReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompletionReportValidationError";
  }
}

const CASE_STATUSES: readonly CompletionCaseStatus[] = ["passed", "failed", "skipped"];
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
// Fixed allowlist: completion settings carry model-run metadata and nothing
// else. There is deliberately no generic secret scanning; only these keys exist.
const ALLOWED_SETTING_KEYS: ReadonlySet<string> = new Set([
  "provider",
  "model",
  "mode",
  "seed",
  "tier",
  "judge",
]);
const MAX_SETTING_VALUE_LENGTH = 200;
const MAX_REASON_LENGTH = 1000;

function fail(message: string): never {
  throw new CompletionReportValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

function assertIsoDate(value: unknown, field: "startedAt" | "finishedAt"): asserts value is string {
  if (
    typeof value !== "string" ||
    !ISO_DATE_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    fail(`completion report ${field} must be an ISO-8601 date string`);
  }
}

function assertSafeSettings(value: unknown): asserts value is Record<string, string> {
  if (!isPlainRecord(value)) {
    fail("completion report settings must be an object");
  }
  for (const [key, setting] of Object.entries(value)) {
    if (!ALLOWED_SETTING_KEYS.has(key)) {
      fail(
        `unsupported completion report settings key "${key}" (allowed: provider, model, mode, seed, tier, judge)`,
      );
    }
    if (typeof setting !== "string") {
      fail(`completion report settings value for "${key}" must be a string`);
    }
    if (setting.length > MAX_SETTING_VALUE_LENGTH || /[\r\n]/.test(setting)) {
      fail(`completion report settings value for "${key}" must be a short single-line string`);
    }
  }
}

/**
 * Structural validation. Rejects malformed dates/status, empty or duplicate
 * cases, an exitCode that contradicts a failed case, and unsafe settings.
 * It does NOT require every case to pass, so failures can still be recorded.
 */
export function assertCompletionReportShape(report: unknown): void {
  if (!isPlainRecord(report)) fail("completion report must be an object");
  if (report.version !== COMPLETION_REPORT_VERSION) {
    fail(`completion report version must be ${COMPLETION_REPORT_VERSION}`);
  }
  if (typeof report.suite !== "string" || report.suite.trim() === "") {
    fail("completion report suite must be a non-empty string");
  }
  assertIsoDate(report.startedAt, "startedAt");
  assertIsoDate(report.finishedAt, "finishedAt");
  if (Date.parse(report.finishedAt) < Date.parse(report.startedAt)) {
    fail("completion report finishedAt must not be before startedAt");
  }
  if (!Array.isArray(report.cases) || report.cases.length === 0) {
    fail("completion report must contain at least one case");
  }
  const seen = new Set<string>();
  for (const testCase of report.cases) {
    if (!isPlainRecord(testCase)) fail("completion report case must be an object");
    if (typeof testCase.id !== "string" || testCase.id.trim() === "") {
      fail("completion report case id must be a non-empty string");
    }
    if (seen.has(testCase.id)) fail(`completion report has duplicate case id "${testCase.id}"`);
    seen.add(testCase.id);
    if (!CASE_STATUSES.includes(testCase.status as CompletionCaseStatus)) {
      fail(
        `completion report case "${testCase.id}" has invalid status "${String(testCase.status)}"`,
      );
    }
    if (
      testCase.reason !== undefined &&
      (typeof testCase.reason !== "string" || testCase.reason.length > MAX_REASON_LENGTH)
    ) {
      fail(`completion report case "${testCase.id}" reason must be a short string`);
    }
  }
  if (!Number.isInteger(report.exitCode)) {
    fail("completion report exitCode must be an integer");
  }
  if (report.exitCode === 0 && report.cases.some((testCase) => testCase.status === "failed")) {
    fail("completion report exitCode 0 is inconsistent with a failed case");
  }
  assertSafeSettings(report.settings);
}

/**
 * Explicit optional-case policy supplied by the caller. Optional cases may be
 * skipped without failing validation; every other case is required. There is
 * no default and no inference: with no policy, any skip is rejected, and
 * optionality is never derived from a case's status or name.
 */
export interface OptionalCasePolicy {
  optionalCaseIds?: readonly string[];
  isOptionalCase?: (testCase: CompletionReportCase) => boolean;
}

export type ValidateCompletionReportOptions = OptionalCasePolicy;

function optionalCaseCheck(
  policy: OptionalCasePolicy = {},
): (testCase: CompletionReportCase) => boolean {
  const ids = new Set(policy.optionalCaseIds ?? []);
  const predicate = policy.isOptionalCase;
  return (testCase) => ids.has(testCase.id) || (predicate?.(testCase) ?? false);
}

/**
 * Strictly validates a completion report as evidence of a completed run.
 * Every case is required unless the caller's explicit optional policy excuses
 * it; optional cases may only be skipped, required skipped or any failed case
 * is rejected, a nonzero exit code is rejected, and at least one required case
 * must actually have executed.
 */
export function validateCompletionReport(
  report: unknown,
  options: ValidateCompletionReportOptions = {},
): void {
  assertCompletionReportShape(report);
  const normalized = report as CompletionReport;
  const isOptional = optionalCaseCheck(options);
  const requiredSkipped = normalized.cases.filter(
    (testCase) => testCase.status === "skipped" && !isOptional(testCase),
  );
  if (requiredSkipped.length > 0) {
    const detail = requiredSkipped.map((testCase) => `${testCase.id}=skipped`).join(", ");
    fail(`completion report has ${requiredSkipped.length} required skipped case(s): ${detail}`);
  }
  const failed = normalized.cases.filter((testCase) => testCase.status === "failed");
  if (failed.length > 0) {
    const detail = failed.map((testCase) => `${testCase.id}=failed`).join(", ");
    fail(`completion report has ${failed.length} failed case(s): ${detail}`);
  }
  if (normalized.exitCode !== 0) {
    fail(`completion report exitCode must be 0 for a completed run, got ${normalized.exitCode}`);
  }
  const requiredExecuted = normalized.cases.filter(
    (testCase) => !isOptional(testCase) && testCase.status !== "skipped",
  );
  if (requiredExecuted.length === 0) {
    fail("completion report has no required executed case");
  }
}

export interface BuildCompletionReportInput {
  suite: string;
  startedAt: string;
  finishedAt: string;
  cases: CompletionReportCase[];
  settings?: Record<string, string>;
  exitCode?: number;
}

export function buildCompletionReport(input: BuildCompletionReportInput): CompletionReport {
  const cases = input.cases.map((testCase) => {
    const normalized: CompletionReportCase = { id: testCase.id, status: testCase.status };
    if (testCase.reason !== undefined) normalized.reason = testCase.reason;
    return normalized;
  });
  return {
    version: COMPLETION_REPORT_VERSION,
    suite: input.suite,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    cases,
    exitCode: input.exitCode ?? (cases.some((testCase) => testCase.status === "failed") ? 1 : 0),
    settings: input.settings ?? {},
  };
}

function normalizeCompletionReport(report: unknown): CompletionReport {
  if (!isPlainRecord(report)) fail("completion report must be an object");
  const rawCases = Array.isArray(report.cases) ? report.cases : [];
  const cases = rawCases.map((testCase) => {
    if (!isPlainRecord(testCase)) return testCase as unknown as CompletionReportCase;
    const normalized: CompletionReportCase = {
      id: testCase.id as string,
      status: testCase.status as CompletionCaseStatus,
    };
    if (testCase.reason !== undefined) normalized.reason = testCase.reason as string;
    return normalized;
  });
  return {
    version: report.version as 1,
    suite: report.suite as string,
    startedAt: report.startedAt as string,
    finishedAt: report.finishedAt as string,
    cases,
    exitCode: report.exitCode as number,
    settings: (isPlainRecord(report.settings) ? { ...report.settings } : report.settings) as Record<
      string,
      string
    >,
  };
}

/**
 * Writes the completion report only when `OPENCANDLE_EVAL_COMPLETION_PATH` is
 * set. The write is atomic (temp file + rename), emits only the known schema
 * fields, and validates the shape first. Returns the written path, or null
 * when the env var is unset/blank.
 */
export function writeCompletionReport(
  report: unknown,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const path = env[COMPLETION_REPORT_PATH_ENV]?.trim();
  if (!path) return null;
  const normalized = normalizeCompletionReport(report);
  assertCompletionReportShape(normalized);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  return path;
}

export interface VitestJsonAssertionResult {
  ancestorTitles?: string[];
  fullName?: string;
  status?: string;
  title?: string;
  duration?: number;
  failureMessages?: string[];
  location?: unknown;
  meta?: unknown;
  tags?: string[];
}

export interface VitestJsonTestResult {
  assertionResults?: VitestJsonAssertionResult[];
  startTime?: number;
  endTime?: number;
  status?: string;
  message?: string;
  name?: string;
}

/** The subset of the Vitest `--reporter=json` payload this converter consumes. */
export interface VitestJsonReportPayload {
  numTotalTestSuites?: number;
  numPassedTestSuites?: number;
  numFailedTestSuites?: number;
  numPendingTestSuites?: number;
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  startTime?: number;
  success?: boolean;
  testResults?: VitestJsonTestResult[];
}

export interface ConvertVitestReportOptions extends OptionalCasePolicy {
  suite: string;
  settings?: Record<string, string>;
  startedAt?: string;
  finishedAt?: string;
}

/**
 * Pure converter from the real Vitest JSON reporter payload to the completion
 * report shape. Skipped/pending/todo tests stay visible as `skipped`; a
 * zero-test or failing payload can never produce a passing report; suite/hook
 * errors add a failed case even when no assertion reports a failure; declared
 * payload counts are cross-checked; at least one required case must have
 * executed; and a required skipped case fails by default. The optional-case
 * policy is explicit caller input and the converter never infers optionality
 * from a case's status or name.
 */
export function convertVitestJsonReport(
  payload: VitestJsonReportPayload,
  options: ConvertVitestReportOptions,
): CompletionReport {
  const isOptional = optionalCaseCheck(options);
  const assertionCases: CompletionReportCase[] = [];
  const suiteErrorCases: CompletionReportCase[] = [];
  const usedIds = new Set<string>();
  const files = Array.isArray(payload.testResults) ? payload.testResults : [];
  let earliest: number | undefined;
  let latest: number | undefined;

  const observeTimes = (start?: number, end?: number): void => {
    if (typeof start === "number" && Number.isFinite(start)) {
      earliest = earliest === undefined ? start : Math.min(earliest, start);
    }
    if (typeof end === "number" && Number.isFinite(end)) {
      latest = latest === undefined ? end : Math.max(latest, end);
    }
  };

  for (const file of files) {
    observeTimes(file.startTime, file.endTime);
    const assertions = Array.isArray(file.assertionResults) ? file.assertionResults : [];
    let fileHasFailedAssertion = false;
    for (const assertion of assertions) {
      const status = mapVitestStatus(assertion.status);
      if (status === "failed") fileHasFailedAssertion = true;
      const rawId = assertion.fullName?.trim() || assertion.title?.trim() || "unnamed test";
      const id = uniqueCaseId(usedIds, rawId, file.name);
      if (status === "failed") {
        assertionCases.push({ id, status, reason: failureReason(assertion.failureMessages) });
      } else if (status === "skipped") {
        assertionCases.push({
          id,
          status,
          reason: `vitest status: ${assertion.status ?? "unknown"}`,
        });
      } else {
        assertionCases.push({ id, status });
      }
    }
    if (file.status === "failed" && !fileHasFailedAssertion) {
      const rawId = file.name ? `suite: ${basename(file.name)}` : "vitest:suite-error";
      suiteErrorCases.push({
        id: uniqueCaseId(usedIds, rawId, file.name),
        status: "failed",
        reason: sanitizeReason(file.message) ?? "Vitest test file failed",
      });
    }
  }

  const mismatchReasons = payloadCountMismatches(payload, assertionCases);
  if (suiteErrorCases.length === 0 && (payload.numFailedTestSuites ?? 0) > 0) {
    mismatchReasons.push("payload reported failing test suites without a file-level error");
  }
  const cases: CompletionReportCase[] = [...assertionCases, ...suiteErrorCases];
  if (mismatchReasons.length > 0) {
    cases.push({
      id: "vitest:payload-mismatch",
      status: "failed",
      reason: `inconsistent Vitest JSON payload: ${mismatchReasons.join("; ")}`,
    });
  }
  if (cases.length === 0) {
    cases.push({
      id: "vitest:no-tests",
      status: "failed",
      reason: "Vitest reported zero test cases",
    });
  } else if (
    assertionCases.length > 0 &&
    !assertionCases.some((testCase) => !isOptional(testCase) && testCase.status !== "skipped")
  ) {
    cases.push({
      id: "vitest:no-required-executed",
      status: "failed",
      reason: "no required test case executed",
    });
  }
  // Vitest sets success=false for failures outside assertions (unhandled
  // errors/rejections) while every assertion can still read as passed.
  if (payload.success === false && !cases.some((testCase) => testCase.status === "failed")) {
    cases.push({
      id: "vitest:run-failed",
      status: "failed",
      reason: "vitest run failed outside test assertions (success=false)",
    });
  }

  const requiredSkipped = assertionCases.filter(
    (testCase) => testCase.status === "skipped" && !isOptional(testCase),
  );
  const startMs = finiteNumber(payload.startTime) ?? earliest ?? 0;
  const endMs = Math.max(latest ?? startMs, startMs);
  return {
    version: COMPLETION_REPORT_VERSION,
    suite: options.suite,
    startedAt: options.startedAt ?? new Date(startMs).toISOString(),
    finishedAt: options.finishedAt ?? new Date(endMs).toISOString(),
    cases,
    exitCode:
      requiredSkipped.length > 0 || cases.some((testCase) => testCase.status === "failed") ? 1 : 0,
    settings: options.settings ?? {},
  };
}

function payloadCountMismatches(
  payload: VitestJsonReportPayload,
  assertionCases: CompletionReportCase[],
): string[] {
  const total = assertionCases.length;
  const passed = assertionCases.filter((testCase) => testCase.status === "passed").length;
  const failed = assertionCases.filter((testCase) => testCase.status === "failed").length;
  const mismatches: string[] = [];
  const check = (label: string, declared: number | undefined, actual: number): void => {
    if (typeof declared === "number" && Number.isFinite(declared) && declared !== actual) {
      mismatches.push(`${label} declared ${declared} but ${actual} case(s) present`);
    }
  };
  check("numTotalTests", payload.numTotalTests, total);
  check("numPassedTests", payload.numPassedTests, passed);
  check("numFailedTests", payload.numFailedTests, failed);
  if (payload.success === true && failed > 0) {
    mismatches.push("success=true with failed test case(s)");
  }
  return mismatches;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function mapVitestStatus(status: string | undefined): CompletionCaseStatus {
  switch (status) {
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "pending":
    case "skipped":
    case "todo":
    case undefined:
      return "skipped";
    default:
      return "skipped";
  }
}

function failureReason(messages: string[] | undefined): string {
  const joined = (messages ?? []).filter((message) => message.trim() !== "").join("\n");
  return sanitizeReason(joined) ?? "vitest assertion failed";
}

function sanitizeReason(reason: string | undefined): string | undefined {
  if (typeof reason !== "string") return undefined;
  const collapsed = reason.replace(/\s+/g, " ").trim();
  if (collapsed === "") return undefined;
  return collapsed.length > MAX_REASON_LENGTH
    ? `${collapsed.slice(0, MAX_REASON_LENGTH - 1)}…`
    : collapsed;
}

function uniqueCaseId(used: Set<string>, rawId: string, fileName: string | undefined): string {
  const base = rawId.trim() || "unnamed test";
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const suffix = fileName ? basename(fileName) : "duplicate";
  let candidate = `${base} [${suffix}]`;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base} [${suffix} #${index}]`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}
