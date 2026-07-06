#!/usr/bin/env tsx
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  buildProductReplayComparison,
  findLatestProductEvalReport,
  summarizeProductReplayReport,
  unsupportedProductReplayRun,
  writeProductReplayComparisonReport,
} from "../evals/main-branch-replay.js";
import type { ProductEvalReport } from "../evals/product/types.js";
import { runSubprocess, type SubprocessResult } from "../evals/subprocess-runner.js";

const cwd = process.cwd();
const baseRef = argValue("--base-ref") ?? process.env.PRODUCT_REPLAY_BASE_REF ?? "origin/main";
const currentRef = currentGitRef(cwd);
const productReplayTimeoutMs = numberFromEnv("PRODUCT_REPLAY_TIMEOUT_MS") ?? 1_000_000;

const currentRun = runProductEval(cwd, currentRef);
const baseWorktree = mkdtempSync(join(tmpdir(), "oc-product-replay-base-"));
let baseRun: ProductEvalReport;

try {
  const added = run("git", ["worktree", "add", "--detach", baseWorktree, baseRef], cwd, "pipe");
  if (added.status !== 0) {
    baseRun = unsupportedProductReplayRun(
      baseRef,
      outputSummary(added) || "failed to create base-ref worktree",
    );
  } else {
    linkInstallArtifacts(cwd, baseWorktree);
    const baseProductEvalCommand = productEvalCommand(baseWorktree);
    baseRun = baseProductEvalCommand
      ? runProductEval(baseWorktree, baseRef, baseProductEvalCommand)
      : unsupportedProductReplayRun(baseRef, "package.json does not define a product eval script");
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

function runProductEval(
  workdir: string,
  ref: string,
  command: string[] = ["npm", "run", "eval", "--", "product"],
) {
  const before = findLatestProductEvalReport(workdir);
  const [executable, ...args] = command;
  const result = run(executable, args, workdir, "inherit", {
    timeoutMs: productReplayTimeoutMs,
  });
  if (result.timedOut) {
    const reason = outputSummary(result, workdir);
    if (workdir === cwd) throw new Error(reason);
    return unsupportedProductReplayRun(ref, reason);
  }
  const reportPath = findLatestProductEvalReport(workdir);
  if (!reportPath || reportPath === before) {
    const reason =
      outputSummary(result, workdir) || `product eval did not produce a report for ${ref}`;
    if (workdir === cwd) throw new Error(reason);
    return unsupportedProductReplayRun(ref, reason);
  }

  const report = JSON.parse(readFileSync(reportPath, "utf-8")) as ProductEvalReport;
  return summarizeProductReplayReport({ ref, reportPath, report });
}

function productEvalCommand(workdir: string): string[] | null {
  const packagePath = join(workdir, "package.json");
  if (!existsSync(packagePath)) return null;
  const packageJson = JSON.parse(readFileSync(packagePath, "utf-8")) as {
    scripts?: Record<string, string>;
  };
  if (typeof packageJson.scripts?.eval === "string") return ["npm", "run", "eval", "--", "product"];
  if (typeof packageJson.scripts?.["test:evals:product"] === "string") {
    return ["npm", "run", "test:evals:product"];
  }
  return null;
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
  options: { timeoutMs?: number } = {},
): SubprocessResult {
  return runSubprocess(command, args, {
    workdir,
    stdio,
    timeoutMs: options.timeoutMs,
  });
}

function outputSummary(result: SubprocessResult, workdir = process.cwd()): string {
  if (result.timedOut) {
    return `${basename(workdir)} command timed out after ${result.timeoutMs ?? "unknown"}ms`;
  }
  const output = `${result.stderr}\n${result.stdout}`.trim();
  const lastLine = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (lastLine) return `${basename(workdir)} command exited ${result.status}: ${lastLine}`;
  return result.status === 0 ? "" : `command exited ${result.status}`;
}

function numberFromEnv(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}="${value}". Expected a positive number of milliseconds.`);
  }
  return parsed;
}

function formatDelta(value: number): string {
  return `${formatSigned(value * 100)}pp`;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
}
