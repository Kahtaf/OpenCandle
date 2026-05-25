#!/usr/bin/env tsx
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import type { ProductEvalReport } from "../evals/product/types.js";
import {
  buildProductReplayComparison,
  findLatestProductEvalReport,
  summarizeProductReplayReport,
  unsupportedProductReplayRun,
  writeProductReplayComparisonReport,
} from "../evals/main-branch-replay.js";

const cwd = process.cwd();
const baseRef = argValue("--base-ref") ?? process.env.PRODUCT_REPLAY_BASE_REF ?? "origin/main";
const currentRef = currentGitRef(cwd);

const currentRun = runProductEval(cwd, currentRef);
const baseWorktree = mkdtempSync(join(tmpdir(), "oc-product-replay-base-"));
let baseRun;

try {
  const added = run("git", ["worktree", "add", "--detach", baseWorktree, baseRef], cwd, "pipe");
  if (added.status !== 0) {
    baseRun = unsupportedProductReplayRun(baseRef, outputSummary(added) || "failed to create base-ref worktree");
  } else {
    linkInstallArtifacts(cwd, baseWorktree);
    baseRun = productEvalSupported(baseWorktree)
      ? runProductEval(baseWorktree, baseRef)
      : unsupportedProductReplayRun(baseRef, "package.json does not define test:evals:product");
  }
} finally {
  rmSync(baseWorktree, { recursive: true, force: true });
  run("git", ["worktree", "prune"], cwd, "pipe");
}

const comparison = buildProductReplayComparison({ current: currentRun, base: baseRun });
const outputPath = writeProductReplayComparisonReport(comparison, cwd);

console.log("\n--- Main Branch Product Replay ---");
console.log(`Current: ${comparison.current.ref} (${comparison.current.status})`);
console.log(`Base: ${comparison.base.ref} (${comparison.base.status})`);
if (comparison.status === "compared") {
  console.log(`Aggregate delta: ${formatDelta(comparison.aggregateDelta ?? 0)}`);
  console.log(`Pass delta: ${formatSigned(comparison.passDelta ?? 0)}`);
  for (const change of comparison.caseChanges.filter((entry) => entry.status !== "unchanged")) {
    console.log(`  ${change.status}: ${change.id} (${formatDelta(change.scoreDelta ?? 0)})`);
  }
} else {
  console.log(`Unsupported: ${comparison.unsupportedReason}`);
}
console.log(`Report: ${outputPath}`);

function runProductEval(workdir: string, ref: string) {
  const before = findLatestProductEvalReport(workdir);
  const result = run("npm", ["run", "test:evals:product"], workdir, "inherit");
  const reportPath = findLatestProductEvalReport(workdir);
  if (!reportPath || reportPath === before) {
    const reason = outputSummary(result) || `product eval did not produce a report for ${ref}`;
    if (workdir === cwd) throw new Error(reason);
    return unsupportedProductReplayRun(ref, reason);
  }

  const report = JSON.parse(readFileSync(reportPath, "utf-8")) as ProductEvalReport;
  return summarizeProductReplayReport({ ref, reportPath, report });
}

function productEvalSupported(workdir: string): boolean {
  const packagePath = join(workdir, "package.json");
  if (!existsSync(packagePath)) return false;
  const packageJson = JSON.parse(readFileSync(packagePath, "utf-8")) as {
    scripts?: Record<string, string>;
  };
  return typeof packageJson.scripts?.["test:evals:product"] === "string";
}

function linkInstallArtifacts(source: string, target: string): void {
  for (const name of ["node_modules", ".env", ".env.local"]) {
    const sourcePath = join(source, name);
    const targetPath = join(target, name);
    if (!existsSync(sourcePath) || existsSync(targetPath)) continue;
    symlinkSync(sourcePath, targetPath, name === "node_modules" ? "dir" : "file");
  }
}

function currentGitRef(workdir: string): string {
  const branch = run("git", ["branch", "--show-current"], workdir, "pipe").stdout.trim();
  if (branch) return branch;
  return run("git", ["rev-parse", "--short", "HEAD"], workdir, "pipe").stdout.trim() || "current";
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1]?.trim();
  return value && !value.startsWith("--") ? value : undefined;
}

function run(
  command: string,
  args: string[],
  workdir: string,
  stdio: "inherit" | "pipe",
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd: workdir,
    env: process.env,
    encoding: "utf-8",
    stdio,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

function outputSummary(result: { status: number | null; stdout: string; stderr: string }): string {
  const output = `${result.stderr}\n${result.stdout}`.trim();
  const lastLine = output.split("\n").map((line) => line.trim()).filter(Boolean).at(-1);
  if (lastLine) return `${basename(process.cwd())} command exited ${result.status}: ${lastLine}`;
  return result.status === 0 ? "" : `command exited ${result.status}`;
}

function formatDelta(value: number): string {
  return `${formatSigned(value * 100)}pp`;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
}
