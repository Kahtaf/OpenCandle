#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  comparePromptPolicyReports,
  type PromptPolicyCase,
  type PromptPolicyParityReport,
} from "../evals/prompt-policy-ref-parity.js";

interface ManifestReport {
  generatedAt: string;
  manifestPath: string;
  selectedPromptIds: string[];
  cases: PromptPolicyCase[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}

interface RefManifestRun {
  label: string;
  cwd: string;
  ref: string;
  reportPath: string;
  report: ManifestReport;
}

interface RefParityRunReport {
  generatedAt: string;
  baseRef: string;
  currentRef: string;
  manifestPath: string;
  selectedPromptIds: string[];
  baseManifestReportPath: string;
  currentManifestReportPath: string;
  parity: PromptPolicyParityReport;
}

const repoRoot = git(["rev-parse", "--show-toplevel"], process.cwd()).trim();
const baseRef = process.env.PROMPT_POLICY_BASE_REF ?? "3e3a039";
const currentRef = process.env.PROMPT_POLICY_CURRENT_REF ?? "WORKTREE";
const manifestPath =
  process.env.PROMPT_POLICY_MANIFEST ?? "docs/internal/prompt-to-policy-migration-manifest.json";
const strictToolCalls = process.env.PROMPT_POLICY_STRICT_TOOL_CALLS === "1";
const keepWorktrees = process.env.PROMPT_POLICY_KEEP_WORKTREES === "1";
const tempRoot = mkdtempSync(join(tmpdir(), "opencandle-prompt-policy-parity-"));
const removableWorktrees: string[] = [];

try {
  const baseCwd = checkoutWorktree("base", baseRef);
  const currentCwd = currentRef === "WORKTREE" ? repoRoot : checkoutWorktree("current", currentRef);

  const base = runManifest({
    cwd: baseCwd,
    label: baseRef,
    ref: baseRef,
  });
  const current = runManifest({
    cwd: currentCwd,
    label: currentRef,
    ref: currentRef,
  });

  const parity = comparePromptPolicyReports({
    baseLabel: base.label,
    currentLabel: current.label,
    baseCases: base.report.cases,
    currentCases: current.report.cases,
    strictToolCalls,
  });
  const outputPath = writeParityReport(base, current, parity);

  console.log("\n--- Prompt-To-Policy Ref Parity Summary ---");
  console.log(`Base: ${base.label}`);
  console.log(`Current: ${current.label}`);
  console.log(`Cases: ${parity.summary.total}`);
  console.log(`Passed: ${parity.summary.passed}`);
  console.log(`Failed: ${parity.summary.failed}`);
  console.log(`Warnings: ${parity.summary.warnings}`);
  console.log(`Report: ${outputPath}`);
  printIssues(parity);

  if (parity.summary.failed > 0) process.exitCode = 1;
} finally {
  if (!keepWorktrees) {
    for (const worktree of removableWorktrees.reverse()) {
      removeWorktree(worktree);
    }
    rmSync(tempRoot, { force: true, recursive: true });
  } else {
    console.log(`Keeping prompt-to-policy parity worktrees under ${tempRoot}`);
  }
}

function checkoutWorktree(name: string, ref: string): string {
  const worktreePath = join(tempRoot, name);
  git(["worktree", "add", "--detach", worktreePath, ref], repoRoot);
  removableWorktrees.push(worktreePath);
  linkNodeModules(worktreePath);
  linkRuntimeFiles(worktreePath);
  return worktreePath;
}

function linkNodeModules(worktreePath: string): void {
  const source = join(repoRoot, "node_modules");
  const destination = join(worktreePath, "node_modules");
  if (!existsSync(source) || existsSync(destination)) return;
  symlinkSync(source, destination, "dir");
}

function linkRuntimeFiles(worktreePath: string): void {
  for (const name of [".env", ".env.local"]) {
    const source = join(repoRoot, name);
    const destination = join(worktreePath, name);
    if (!existsSync(source) || existsSync(destination)) continue;
    symlinkSync(source, destination);
  }
}

function runManifest(input: { cwd: string; label: string; ref: string }): RefManifestRun {
  console.log(`\n=== Running prompt policy manifest for ${input.label}`);
  const stdout = execFileSync("npx", ["tsx", "tests/scripts/run-prompt-policy-manifest.ts"], {
    cwd: input.cwd,
    env: {
      ...process.env,
      PROMPT_POLICY_MANIFEST: manifestPath,
      PROMPT_POLICY_STRICT: "0",
    },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  process.stdout.write(stdout);
  const reportPath = parseReportPath(stdout);
  const report = JSON.parse(readFileSync(reportPath, "utf-8")) as ManifestReport;
  return {
    label: input.label,
    cwd: input.cwd,
    ref: input.ref,
    reportPath,
    report,
  };
}

function parseReportPath(stdout: string): string {
  const match = stdout.match(/^Report:\s+(.+)$/m);
  if (!match?.[1]) {
    throw new Error("Prompt policy manifest did not print a report path");
  }
  return match[1].trim();
}

function writeParityReport(
  base: RefManifestRun,
  current: RefManifestRun,
  parity: PromptPolicyParityReport,
): string {
  const runsDir = join(repoRoot, "tests", "evals", "runs");
  mkdirSync(runsDir, { recursive: true });
  const path = join(
    runsDir,
    `${new Date().toISOString().replace(/[:.]/g, "-")}_prompt-policy-ref-parity.json`,
  );
  const report: RefParityRunReport = {
    generatedAt: new Date().toISOString(),
    baseRef,
    currentRef,
    manifestPath,
    selectedPromptIds: current.report.selectedPromptIds,
    baseManifestReportPath: base.reportPath,
    currentManifestReportPath: current.reportPath,
    parity,
  };
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return path;
}

function printIssues(parity: PromptPolicyParityReport): void {
  for (const entry of parity.cases) {
    for (const failure of entry.failures) {
      console.log(`FAIL ${entry.id} ${failure.field}: ${failure.message}`);
    }
    for (const warning of entry.warnings) {
      console.log(`WARN ${entry.id} ${warning.field}: ${warning.message}`);
    }
  }
}

function removeWorktree(worktreePath: string): void {
  try {
    git(["worktree", "remove", "--force", worktreePath], repoRoot);
  } catch (error) {
    console.warn(
      `Could not remove worktree ${worktreePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
