import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductEvalCaseResult, ProductEvalReport, PromptFamily } from "./product/types.js";

export type ProductReplayRunSummary = ProductReplaySupportedRun | ProductReplayUnsupportedRun;

export interface ProductReplaySupportedRun {
  status: "ok";
  ref: string;
  reportPath: string;
  generatedAt: string;
  caseCount: number;
  aggregate: number;
  passed: number;
  failed: number;
  cases: ProductReplayCaseSummary[];
}

export interface ProductReplayUnsupportedRun {
  status: "unsupported";
  ref: string;
  reason: string;
}

export interface ProductReplayCaseSummary {
  id: string;
  family: PromptFamily;
  prompt: string;
  score: number;
  passed: boolean;
}

export type ProductReplayCaseChangeStatus =
  | "improved"
  | "regressed"
  | "unchanged"
  | "current_only"
  | "base_only";

export interface ProductReplayCaseChange {
  id: string;
  family: PromptFamily;
  prompt: string;
  status: ProductReplayCaseChangeStatus;
  baseScore?: number;
  currentScore?: number;
  scoreDelta?: number;
  basePassed?: boolean;
  currentPassed?: boolean;
}

export interface ProductReplayComparison {
  generatedAt: string;
  evalMode: "product";
  status: "compared" | "unsupported";
  current: ProductReplayRunSummary;
  base: ProductReplayRunSummary;
  aggregateDelta?: number;
  passDelta?: number;
  caseChanges: ProductReplayCaseChange[];
  unsupportedReason?: string;
}

export function summarizeProductReplayReport(input: {
  ref: string;
  reportPath: string;
  report: ProductEvalReport;
}): ProductReplaySupportedRun {
  return {
    status: "ok",
    ref: input.ref,
    reportPath: input.reportPath,
    generatedAt: input.report.generatedAt,
    caseCount: input.report.caseCount,
    aggregate: input.report.aggregate,
    passed: input.report.passed,
    failed: input.report.failed,
    cases: input.report.results.map(summarizeCase),
  };
}

export function unsupportedProductReplayRun(
  ref: string,
  reason: string,
): ProductReplayUnsupportedRun {
  return { status: "unsupported", ref, reason };
}

export function buildProductReplayComparison(input: {
  current: ProductReplayRunSummary;
  base: ProductReplayRunSummary;
  generatedAt?: string;
}): ProductReplayComparison {
  if (input.current.status === "unsupported" || input.base.status === "unsupported") {
    const unsupported = input.current.status === "unsupported" ? input.current : input.base;
    return {
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      evalMode: "product",
      status: "unsupported",
      current: input.current,
      base: input.base,
      caseChanges: [],
      unsupportedReason: unsupported.reason,
    };
  }

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    evalMode: "product",
    status: "compared",
    current: input.current,
    base: input.base,
    aggregateDelta: input.current.aggregate - input.base.aggregate,
    passDelta: input.current.passed - input.base.passed,
    caseChanges: compareCases(input.current.cases, input.base.cases),
  };
}

export function writeProductReplayComparisonReport(
  report: ProductReplayComparison,
  cwd = process.cwd(),
): string {
  const runsDir = join(cwd, "tests", "evals", "runs");
  mkdirSync(runsDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const outputPath = join(runsDir, `${stamp}_product-replay-comparison.json`);
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return outputPath;
}

export function findLatestProductEvalReport(cwd = process.cwd()): string | null {
  const runsDir = join(cwd, "tests", "evals", "runs");
  let files: string[];
  try {
    files = readdirSync(runsDir);
  } catch {
    return null;
  }

  const reports = files.filter((file) => file.endsWith("_product-evals.json")).sort();
  const latest = reports.at(-1);
  return latest ? join(runsDir, latest) : null;
}

function summarizeCase(result: ProductEvalCaseResult): ProductReplayCaseSummary {
  return {
    id: result.id,
    family: result.family,
    prompt: result.prompt,
    score: result.score,
    passed: result.passed,
  };
}

function compareCases(
  currentCases: ProductReplayCaseSummary[],
  baseCases: ProductReplayCaseSummary[],
): ProductReplayCaseChange[] {
  const currentById = new Map(currentCases.map((entry) => [entry.id, entry]));
  const baseById = new Map(baseCases.map((entry) => [entry.id, entry]));
  const ids = [...new Set([...baseById.keys(), ...currentById.keys()])].sort();

  return ids.map((id) => {
    const current = currentById.get(id);
    const base = baseById.get(id);
    if (!current && base) {
      return {
        id,
        family: base.family,
        prompt: base.prompt,
        status: "base_only",
        baseScore: base.score,
        basePassed: base.passed,
      };
    }
    if (current && !base) {
      return {
        id,
        family: current.family,
        prompt: current.prompt,
        status: "current_only",
        currentScore: current.score,
        currentPassed: current.passed,
      };
    }
    if (!current || !base) {
      throw new Error(`Unexpected missing product replay case ${id}`);
    }

    const scoreDelta = current.score - base.score;
    return {
      id,
      family: current.family,
      prompt: current.prompt,
      status: caseStatus(scoreDelta, current.passed, base.passed),
      baseScore: base.score,
      currentScore: current.score,
      scoreDelta,
      basePassed: base.passed,
      currentPassed: current.passed,
    };
  });
}

function caseStatus(
  scoreDelta: number,
  currentPassed: boolean,
  basePassed: boolean,
): ProductReplayCaseChangeStatus {
  if (currentPassed && !basePassed) return "improved";
  if (!currentPassed && basePassed) return "regressed";
  if (scoreDelta > 0) return "improved";
  if (scoreDelta < 0) return "regressed";
  return "unchanged";
}
