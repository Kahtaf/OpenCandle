#!/usr/bin/env tsx
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUCT_EVAL_CASES } from "../evals/product/cases.js";
import { productEvalExitCode } from "../evals/product/reporting.js";
import { buildProductEvalReport, scoreProductEvalCase } from "../evals/product/scorer.js";
import { seedProductEvalMarketState } from "../evals/product/state-fixtures.js";
import type { ProductEvalCase, PromptFamily } from "../evals/product/types.js";
import { runOpenCandleSession } from "../harness/opencandle-runner.js";

const selectedCases = selectCases(PRODUCT_EVAL_CASES);
if (selectedCases.length === 0) {
  throw new Error("No product eval cases selected");
}

const results = [];
for (const evalCase of selectedCases) {
  console.log(`\n=== ${evalCase.id}: ${evalCase.prompt}`);
  const openCandleHome = evalCase.setup?.marketStateFixture
    ? mkdtempSync(join(tmpdir(), "oc-product-eval-home-"))
    : undefined;
  try {
    if (openCandleHome && evalCase.setup?.marketStateFixture) {
      seedProductEvalMarketState(evalCase.setup.marketStateFixture, openCandleHome);
    }
    const { evalTrace } = await runOpenCandleSession({
      prompt: evalCase.prompts ? undefined : evalCase.prompt,
      prompts: evalCase.prompts,
      scriptedAnswers: evalCase.answers,
      openCandleHome,
      timeoutMs: 900_000,
    });
    const result = scoreProductEvalCase(evalCase, evalTrace);
    results.push(result);
    console.log(`score=${formatPct(result.score)} ${result.passed ? "PASS" : "FAIL"}`);
    for (const dimension of result.dimensions) {
      console.log(`  ${dimension.passed ? "✓" : "✗"} ${dimension.id}: ${dimension.message}`);
    }
  } finally {
    if (openCandleHome) rmSync(openCandleHome, { recursive: true, force: true });
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
  const includeOptIn = process.env.PRODUCT_EVAL_INCLUDE_OPT_IN === "1";
  const limit = numberFromEnv("PRODUCT_EVAL_LIMIT");
  let selected = cases;
  if (!id && !includeOptIn) selected = selected.filter((evalCase) => evalCase.tier !== "opt-in");
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
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
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
