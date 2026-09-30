#!/usr/bin/env node

// Advisory repeated-run flake lane (#209).
//
//   node scripts/flake-lane.mjs --suite <gate step> --runs <N> [-- <step args>]
//
// Runs one gate-policy step N times, sequentially, with no retry and no early
// stop, and writes the per-run outcome plus the first failure's log to
// validation-output/flake/<suite>/. It is a measurement, not a gate: it never
// feeds release evidence and never replaces the single diagnostic rerun the
// test trust policy allows. The process exits non-zero when any run failed so
// the (continue-on-error) CI step is visibly red.

import { spawn } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNpmInvocation } from "./npm-command.mjs";
import { loadGatePolicy } from "./test-gate.mjs";

const MAX_RUNS = 100;
// Keep the tail of each run's output; a failing e2e prints its dump last.
const MAX_LOG_CHARS = 200_000;

export function parseFlakeLaneArgs(argv) {
  const separator = argv.indexOf("--");
  const own = separator === -1 ? argv : argv.slice(0, separator);
  const args = separator === -1 ? [] : argv.slice(separator + 1);
  let suite;
  let runs;
  for (let index = 0; index < own.length; index += 1) {
    const flag = own[index];
    if (flag === "--suite") suite = own[++index];
    else if (flag === "--runs") runs = own[++index];
    else throw new Error(`unknown flake-lane argument "${flag}"`);
  }
  if (!suite) throw new Error("--suite <gate step> is required");
  const count = Number(runs);
  if (!/^\d+$/.test(String(runs)) || count < 1 || count > MAX_RUNS) {
    throw new Error(`--runs must be an integer from 1 to ${MAX_RUNS}`);
  }
  return { suite, runs: count, args };
}

function suiteSlug(suite) {
  return suite.replace(/[^a-z0-9._-]+/gi, "-");
}

function runOnce({ command, args, env, echo }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let output = "";
    const keep = (chunk) => {
      const text = chunk.toString();
      if (echo) process.stdout.write(text);
      output = (output + text).slice(-MAX_LOG_CHARS);
    };
    const child = spawn(command, args, { env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (error) => {
      output += `\nflake-lane: failed to start step: ${error.message}\n`;
    });
    child.on("close", (status, signal) => {
      resolve({ status, signal, durationMs: Date.now() - startedAt, output });
    });
  });
}

export async function runFlakeLane({
  suite,
  runs,
  args = [],
  policy = loadGatePolicy(),
  outRoot = join(process.cwd(), "validation-output", "flake"),
  invoke = () => buildNpmInvocation("npm", ["run", suite, ...(args.length ? ["--", ...args] : [])]),
  log = console.log,
  echo = true,
}) {
  if (!policy.release.includes(suite)) {
    throw new Error(
      `"${suite}" is not a step in the gate policy; the flake lane only repeats gate steps`,
    );
  }
  const reportDir = join(outRoot, suiteSlug(suite));
  rmSync(reportDir, { recursive: true, force: true });
  mkdirSync(reportDir, { recursive: true });
  const runsPath = join(reportDir, "runs.jsonl");
  const results = [];
  let firstFailedRun = null;
  for (let run = 1; run <= runs; run += 1) {
    // A private TMPDIR per run: repeated runs must not share temp state, and
    // other gate runs on the same machine must not collide with this one.
    const runTmp = mkdtempSync(join(tmpdir(), "opencandle-flake-"));
    const { command, args: commandArgs } = invoke(run);
    log(`\n▶ flake ${suite} run ${run}/${runs}`);
    const outcome = await runOnce({
      command,
      args: commandArgs,
      env: { ...process.env, TMPDIR: runTmp, OPENCANDLE_FLAKE_RUN: String(run) },
      echo,
    });
    rmSync(runTmp, { recursive: true, force: true });
    const entry = {
      run,
      status: outcome.status,
      signal: outcome.signal,
      durationMs: outcome.durationMs,
    };
    results.push(entry);
    appendFileSync(runsPath, `${JSON.stringify(entry)}\n`);
    const passed = outcome.status === 0 && !outcome.signal;
    if (!passed && firstFailedRun === null) {
      firstFailedRun = run;
      writeFileSync(join(reportDir, "first-failure.log"), outcome.output);
    }
    log(
      `${passed ? "✔" : "✖"} flake ${suite} run ${run}/${runs} (${outcome.status ?? outcome.signal})`,
    );
  }
  const passes = results.filter((entry) => entry.status === 0 && !entry.signal).length;
  const result = {
    suite,
    args,
    runs,
    passes,
    failures: runs - passes,
    firstFailedRun,
    results,
    reportDir,
  };
  const { reportDir: _dir, ...summary } = result;
  writeFileSync(join(reportDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return result;
}

export function formatFlakeSummary(result) {
  const label = [result.suite, ...result.args].join(" ");
  const verdict = result.failures === 0 ? "stable" : `first failure: run ${result.firstFailedRun}`;
  return `| \`${label}\` | ${result.passes}/${result.runs} passed | ${verdict} |\n`;
}

async function main(argv) {
  const options = parseFlakeLaneArgs(argv);
  const result = await runFlakeLane(options);
  const line = formatFlakeSummary(result);
  console.log(`\nflake lane: ${line.trim()}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line);
  if (result.failures > 0) process.exitCode = 1;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`flake-lane: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  });
}
