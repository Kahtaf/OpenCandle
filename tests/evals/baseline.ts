import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactSensitiveOutput } from "../../src/onboarding/provider-status.js";
import type { EvalCaseResult, EvalReport, EvalTrace } from "./types.js";

const BASELINE_PATH = join(import.meta.dirname, "baseline.json");
const REGRESSION_THRESHOLD = 0.05;
const DIAGNOSTICS_DIR = join(
  import.meta.dirname,
  "..",
  "..",
  "validation-output",
  "eval-diagnostics",
);
const MAX_DIAGNOSTIC_CHARS = 32_000;
const MAX_DIAGNOSTIC_TOOL_CALLS = 50;
const MAX_DIAGNOSTIC_OBJECT_ENTRIES = 100;
const MAX_DIAGNOSTIC_DEPTH = 8;
const SENSITIVE_KEY_PATTERN =
  /pass(word)?|secret|token|cookie|credential|api[_-]?key|session|authorization/i;

/** Layer names on a case result whose detail did not pass. */
export function failedLayerNames(result: EvalCaseResult): string[] {
  return Object.entries(result.layers)
    .filter(([, detail]) => !detail.passed)
    .map(([name]) => name);
}

interface BaselineData {
  aggregate: number;
  cases: Record<string, number>;
}

export function loadBaseline(): BaselineData | null {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as BaselineData;
}

export function saveBaseline(report: EvalReport): void {
  const data: BaselineData = {
    aggregate: report.aggregate,
    cases: Object.fromEntries(report.cases.map((c) => [c.name, c.score])),
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

export function buildReport(results: EvalCaseResult[]): EvalReport {
  const baseline = loadBaseline();
  const scores = results.map((r) => r.score);
  const aggregate = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 1.0;

  const baselineAggregate = baseline?.aggregate ?? null;
  const delta = baselineAggregate !== null ? aggregate - baselineAggregate : null;

  const improved: string[] = [];
  const regressed: string[] = [];
  const unchanged: string[] = [];

  for (const result of results) {
    const baselineScore = baseline?.cases[result.name];
    if (baselineScore === undefined) {
      improved.push(result.name);
    } else if (result.score > baselineScore + 0.01) {
      improved.push(result.name);
    } else if (result.score < baselineScore - 0.01) {
      regressed.push(result.name);
    } else {
      unchanged.push(result.name);
    }
  }

  const safetyCriticalFailures = results.filter((r) => r.safetyCriticalFailure).map((r) => r.name);
  const layerFailures = results.filter((r) => failedLayerNames(r).length > 0).map((r) => r.name);

  const aggregateRegression = delta !== null && delta < -REGRESSION_THRESHOLD;
  const regression =
    aggregateRegression || safetyCriticalFailures.length > 0 || layerFailures.length > 0;

  return {
    cases: results,
    aggregate,
    baseline: baselineAggregate,
    delta,
    regression,
    safetyCriticalFailures,
    improved,
    regressed,
    unchanged,
  };
}

const RUNS_DIR = join(import.meta.dirname, "runs");

function currentBranchOrChange(): string {
  try {
    const branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
    if (branch) return branch;
  } catch {
    /* ignore */
  }
  return "unknown";
}

/**
 * Save an eval run to tests/evals/runs/ with date and feature name.
 * File format: YYYY-MM-DD_HHmmss_<feature>.json
 */
export function saveRun(report: EvalReport, feature?: string): string {
  mkdirSync(RUNS_DIR, { recursive: true });

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "");
  const name = (feature || currentBranchOrChange()).replace(/[^a-zA-Z0-9_-]/g, "-");
  const filename = `${date}_${time}_${name}.json`;
  const filepath = join(RUNS_DIR, filename);

  const runData = {
    timestamp: now.toISOString(),
    feature: feature || currentBranchOrChange(),
    report,
    summary: formatReport(report),
  };

  writeFileSync(filepath, `${JSON.stringify(runData, null, 2)}\n`, "utf-8");
  return filepath;
}

export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push("=== Eval Report ===");
  lines.push(`Aggregate: ${(report.aggregate * 100).toFixed(1)}%`);

  if (report.baseline !== null) {
    lines.push(`Baseline:  ${(report.baseline * 100).toFixed(1)}%`);
    lines.push(`Delta:     ${report.delta! >= 0 ? "+" : ""}${(report.delta! * 100).toFixed(1)}%`);
    lines.push(`Regression: ${report.regression ? "YES" : "no"}`);
  } else {
    lines.push("Baseline:  (none)");
  }

  if (report.safetyCriticalFailures.length > 0) {
    lines.push(`\nSAFETY-CRITICAL FAILURES: ${report.safetyCriticalFailures.join(", ")}`);
  }

  lines.push("\n--- Per-case Results ---");
  for (const c of report.cases) {
    const status = c.safetyCriticalFailure
      ? "SAFETY-FAIL"
      : failedLayerNames(c).length > 0 || c.score < 0.8
        ? "FAIL"
        : "PASS";
    lines.push(`  [${status}] ${c.name}: ${(c.score * 100).toFixed(1)}%`);
    for (const [layer, detail] of Object.entries(c.layers)) {
      lines.push(`    ${layer}: ${detail.passed ? "✓" : "✗"} ${detail.message ?? ""}`);
    }
  }

  if (report.improved.length > 0) lines.push(`\nImproved: ${report.improved.join(", ")}`);
  if (report.regressed.length > 0) lines.push(`Regressed: ${report.regressed.join(", ")}`);
  if (report.unchanged.length > 0) lines.push(`Unchanged: ${report.unchanged.join(", ")}`);

  return lines.join("\n");
}

export interface FailureDiagnosticOptions {
  /** Directory for the artifact; defaults to the ignored `validation-output/`. */
  dir?: string;
  /** Score floor that counts as a failed assertion; defaults to 0.8. */
  threshold?: number;
  now?: Date;
}

/**
 * A provider can name its own credential inside a natural-language message,
 * for example "We have detected your API key as <value> and our standard API
 * rate limit is 25 requests per day." The repo's `redactSensitiveOutput` only
 * catches `name=value` assignments, cookie headers, and credential paths, so
 * this bounded, case-insensitive phrase pass redacts just the token after
 * "API key as" and leaves the surrounding diagnostic readable.
 */
const API_KEY_AS_PHRASE =
  /\b(api[\s_-]?key\s+as\s+)([A-Za-z0-9_+=./-]+?)(?=[.,;:!?)\]}'"]?(?:\s|$))/gi;

function redactDiagnosticString(value: string): string {
  return redactSensitiveOutput(value.replace(API_KEY_AS_PHRASE, "$1[redacted]")).slice(
    0,
    MAX_DIAGNOSTIC_CHARS,
  );
}

/**
 * Recursively redact a trace value for local failure diagnostics.
 *
 * Values are passed through the repo's existing `redactSensitiveOutput`
 * pattern (plus the bounded API-key-as phrase pass above), and object keys
 * that name credentials/sessions are replaced wholesale so quoted JSON keys
 * cannot smuggle a secret through. Each string, array, and object entry count
 * is capped so a single value cannot balloon the artifact.
 */
function redactForDiagnostic(value: unknown, depth = 0): unknown {
  if (depth > MAX_DIAGNOSTIC_DEPTH) return "[truncated-depth]";
  if (typeof value === "string") {
    return redactDiagnosticString(value);
  }
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_DIAGNOSTIC_TOOL_CALLS)
      .map((item) => redactForDiagnostic(item, depth + 1));
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_DIAGNOSTIC_OBJECT_ENTRIES)) {
    redacted[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? "[redacted]"
      : redactForDiagnostic(item, depth + 1);
  }
  return redacted;
}

/**
 * Redact layer messages while preserving the `passed`/`score` signals.
 *
 * A wholesale `redactForDiagnostic` pass would match the `pass(word)?` secret
 * key and replace the boolean `passed` flag itself, so layers are handled
 * structurally: booleans and numbers stay, and only `message` is redacted.
 */
function redactLayers(layers: EvalCaseResult["layers"]): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [name, detail] of Object.entries(layers)) {
    redacted[name] = {
      passed: detail.passed,
      score: detail.score,
      ...(detail.message === undefined ? {} : { message: redactForDiagnostic(detail.message) }),
    };
  }
  return redacted;
}

/** Sanitize a case name into a filename component with no path separators. */
function safeDiagnosticName(caseName: string): string {
  return (
    caseName
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^[-_]+|[-_]+$/g, "")
      .slice(0, 60) || "case"
  );
}

function diagnosticFilename(caseName: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const unique = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  return `${stamp}_${safeDiagnosticName(caseName)}_${unique}.json`;
}

const TOOL_CALL_KEYS = ["name", "args", "result", "isError", "promptIndex"] as const;

interface WorkflowDiagnosticSummary {
  workflow?: string;
  terminalStatus?: string;
  validationFailedSteps: string[];
}

/**
 * Safe workflow terminal summary for the failure diagnostic. Reads only the
 * workflow name, terminal status, and validation-failed step names from the
 * captured `opencandle-*` custom entries; never persists raw entries.
 */
function summarizeWorkflowDiagnostic(trace: EvalTrace): WorkflowDiagnosticSummary {
  const entries = trace.customEntries ?? [];
  const findData = (customType: string): Record<string, unknown> | undefined => {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry?.customType !== customType) continue;
      const data = entry.data;
      if (typeof data === "object" && data !== null && !Array.isArray(data)) {
        return data as Record<string, unknown>;
      }
    }
    return undefined;
  };

  const workflowData = findData("opencandle-workflow");
  const completeData = findData("opencandle-workflow-complete");
  const validationFailedSteps = [
    ...new Set(
      entries
        .filter((entry) => entry.customType === "opencandle-workflow-event")
        .map((entry) => entry.data)
        .filter(
          (data): data is Record<string, unknown> =>
            typeof data === "object" && data !== null && !Array.isArray(data),
        )
        .filter(
          (data) =>
            data.eventType === "output_validation_failed" && typeof data.stepType === "string",
        )
        .map((data) => data.stepType as string),
    ),
  ];

  return {
    workflow: typeof workflowData?.workflow === "string" ? workflowData.workflow : undefined,
    terminalStatus: typeof completeData?.status === "string" ? completeData.status : undefined,
    validationFailedSteps,
  };
}

/**
 * Persist a bounded, redacted trace diagnostic for a failed eval assertion.
 *
 * Returns `null` when the case passes (no failed layer, no safety-critical
 * failure, and score at or above `threshold`), so callers can invoke it
 * unconditionally. The artifact lives under the gitignored
 * `validation-output/eval-diagnostics/` by default, is written owner-only
 * (`0o600`), and never overwrites an existing file. Bounding is per field:
 * strings are capped, tool calls and array lengths are capped, object entry
 * counts are capped, and nesting is capped, so it is not an unbounded dump.
 */
export function saveFailureDiagnostic(
  result: EvalCaseResult,
  trace: EvalTrace,
  options: FailureDiagnosticOptions = {},
): string | null {
  const failedLayers = failedLayerNames(result);
  const threshold = options.threshold ?? 0.8;
  if (!result.safetyCriticalFailure && failedLayers.length === 0 && result.score >= threshold) {
    return null;
  }

  const now = options.now ?? new Date();
  const dir = options.dir ?? DIAGNOSTICS_DIR;
  mkdirSync(dir, { recursive: true });

  const toolCalls = trace.toolCalls.slice(0, MAX_DIAGNOSTIC_TOOL_CALLS).map((call) => {
    const entry: Record<string, unknown> = {};
    for (const key of TOOL_CALL_KEYS) {
      if (key === "name") {
        entry.name = call.name;
      } else if (call[key] !== undefined) {
        entry[key] = redactForDiagnostic(call[key]);
      }
    }
    return entry;
  });

  const workflowDiagnostics = summarizeWorkflowDiagnostic(trace);

  const artifact = {
    timestamp: now.toISOString(),
    case: redactForDiagnostic(result.name),
    tier: result.tier,
    score: result.score,
    failedLayers,
    safetyCriticalFailure: result.safetyCriticalFailure,
    layers: redactLayers(result.layers),
    prompt: redactForDiagnostic(trace.prompt),
    responseText: redactForDiagnostic(trace.text),
    // Sanitized terminal metadata explains an empty/unresolved final answer:
    // a blank successful stop vs. an error/aborted terminal assistant message.
    ...(trace.terminalOutcome === undefined
      ? {}
      : { terminalOutcome: redactForDiagnostic(trace.terminalOutcome) }),
    toolCalls,
    askUserTranscript: redactForDiagnostic(trace.askUserTranscript),
    ...(workflowDiagnostics.workflow === undefined
      ? {}
      : { workflow: redactForDiagnostic(workflowDiagnostics.workflow) }),
    ...(workflowDiagnostics.terminalStatus === undefined
      ? {}
      : { workflowTerminalStatus: redactForDiagnostic(workflowDiagnostics.terminalStatus) }),
    workflowValidationFailedSteps: redactForDiagnostic(workflowDiagnostics.validationFailedSteps),
  };
  const content = `${JSON.stringify(artifact, null, 2)}\n`;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const filepath = join(dir, diagnosticFilename(result.name, now));
    try {
      writeFileSync(filepath, content, { encoding: "utf-8", flag: "wx", mode: 0o600 });
      return filepath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("could not allocate a unique eval failure diagnostic filename");
}
