#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  appendRunIndexEntry,
  diffRunReports,
  RELEASE_SEQUENCE,
  type ResolvedEvalCommand,
  resolveEvalCommand,
  type SuiteResult,
  snapshotRunReports,
  suiteListText,
  summarizeReleaseResults,
} from "./run-evals-table.js";

const cwd = process.cwd();
const [suiteId, ...suiteArgs] = process.argv.slice(2);

if (!suiteId) {
  console.log("Available eval suites:");
  console.log(suiteListText());
  process.exit(0);
}

try {
  const exitCode = suiteId === "release" ? runRelease(suiteArgs) : runSuite(suiteId, suiteArgs);
  process.exit(exitCode);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function runRelease(argv: string[]): number {
  const startedAt = new Date().toISOString();
  const runsDir = join(cwd, "tests", "evals", "runs");
  const before = snapshotRunReports(runsDir);
  const results: SuiteResult[] = [];

  for (const suite of RELEASE_SEQUENCE) {
    results.push({ suite, exitCode: runResolved(resolveEvalCommand(suite, [])) });
  }

  const summary = summarizeReleaseResults(results);
  console.log("\n--- Eval Release Summary ---");
  for (const row of summary.rows) {
    console.log(`${row.suite.padEnd(22)} ${row.status} exit=${row.exitCode}`);
  }

  appendRunIndexEntry({
    cwd,
    suite: "release",
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: summary.exitCode,
    reports: diffRunReports(runsDir, before, cwd),
    argv: ["release", ...argv],
  });
  return summary.exitCode;
}

function runSuite(suite: string, argv: string[]): number {
  const startedAt = new Date().toISOString();
  const runsDir = join(cwd, "tests", "evals", "runs");
  const before = snapshotRunReports(runsDir);
  const resolved = resolveEvalCommand(suite, argv);
  const exitCode = runResolved(resolved);
  appendRunIndexEntry({
    cwd,
    suite,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    reports: diffRunReports(runsDir, before, cwd),
    argv: [suite, ...argv],
  });
  return exitCode;
}

function runResolved(resolved: ResolvedEvalCommand): number {
  printResolved(resolved);
  const result = spawnSync(resolved.command, resolved.args, {
    cwd,
    env: { ...process.env, ...resolved.env },
    shell: false,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

function printResolved(resolved: ResolvedEvalCommand): void {
  console.log(`\n=== eval:${resolved.suite} ===`);
  console.log(`Command: ${[resolved.command, ...resolved.args].join(" ")}`);
  const envEntries = Object.entries(resolved.env).sort(([a], [b]) => a.localeCompare(b));
  if (envEntries.length === 0) {
    console.log("Env: (none set by front door)");
    return;
  }
  console.log("Env:");
  for (const [key, value] of envEntries) {
    console.log(`  ${key}=${value}`);
  }
}
