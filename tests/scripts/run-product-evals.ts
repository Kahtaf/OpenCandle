#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PRODUCT_EVAL_CASES } from "../evals/product/cases.js";
import { productEvalExitCode } from "../evals/product/reporting.js";
import { buildProductEvalReport, scoreProductEvalCase } from "../evals/product/scorer.js";
import type { ProductEvalCase, PromptFamily } from "../evals/product/types.js";
import { runOpenCandleSession } from "../harness/opencandle-runner.js";

const selectedCases = selectCases(PRODUCT_EVAL_CASES);
if (selectedCases.length === 0) {
  throw new Error("No product eval cases selected");
}

const results = [];
for (const evalCase of selectedCases) {
  console.log(`\n=== ${evalCase.id}: ${evalCase.prompt}`);
  const { evalTrace } = await runOpenCandleSession({
    prompt: evalCase.prompt,
    scriptedAnswers: evalCase.answers,
    timeoutMs: 900_000,
  });
  const result = scoreProductEvalCase(evalCase, evalTrace);
  results.push(result);
  console.log(`score=${formatPct(result.score)} ${result.passed ? "PASS" : "FAIL"}`);
  for (const dimension of result.dimensions) {
    console.log(`  ${dimension.passed ? "✓" : "✗"} ${dimension.id}: ${dimension.message}`);
  }
}

const report = buildProductEvalReport(results);
const outputPath = writeReport(report);
console.log("\n--- Product Eval Summary ---");
console.log(`Cases: ${report.caseCount}`);
console.log(`Aggregate: ${formatPct(report.aggregate)}`);
console.log(`Passed: ${report.passed}`);
console.log(`Failed: ${report.failed}`);
console.log(`Report: ${outputPath}`);
process.exitCode = productEvalExitCode(report);

function selectCases(cases: ProductEvalCase[]): ProductEvalCase[] {
  const id = process.env.PRODUCT_EVAL_CASE?.trim();
  const family = process.env.PRODUCT_EVAL_FAMILY?.trim() as PromptFamily | undefined;
  const limit = numberFromEnv("PRODUCT_EVAL_LIMIT");
  let selected = cases;
  if (id) selected = selected.filter((evalCase) => evalCase.id === id);
  if (family) selected = selected.filter((evalCase) => evalCase.family === family);
  return limit ? selected.slice(0, limit) : selected;
}

function writeReport(report: ReturnType<typeof buildProductEvalReport>): string {
  const runsDir = join(process.cwd(), "tests", "evals", "runs");
  mkdirSync(runsDir, { recursive: true });
  const path = join(
    runsDir,
    `${new Date().toISOString().replace(/[:.]/g, "-")}_product-evals.json`,
  );
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n", "utf-8");
  return path;
}

function numberFromEnv(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
