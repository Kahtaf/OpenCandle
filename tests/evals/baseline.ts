import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalCaseResult, EvalReport } from "./types.js";

const BASELINE_PATH = join(import.meta.dirname, "baseline.json");
const REGRESSION_THRESHOLD = 0.05;

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
  writeFileSync(BASELINE_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
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

  const safetyCriticalFailures = results
    .filter((r) => r.safetyCriticalFailure)
    .map((r) => r.name);

  const aggregateRegression = delta !== null && delta < -REGRESSION_THRESHOLD;
  const regression = aggregateRegression || safetyCriticalFailures.length > 0;

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
  } catch { /* ignore */ }
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

  writeFileSync(filepath, JSON.stringify(runData, null, 2) + "\n", "utf-8");
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
    const status = c.safetyCriticalFailure ? "SAFETY-FAIL" : c.score >= 0.8 ? "PASS" : "FAIL";
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
