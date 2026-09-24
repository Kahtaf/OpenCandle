#!/usr/bin/env node

// Shared proof-gate runner. `gates`, `gates:full`, and `release:check` all
// dispatch here so the policy lives in one auditable file
// (`scripts/test-gate-policy.json`) instead of three drifting shell strings.
//
// Each step is a package script, spawned sequentially through `npm run <name>`
// with `shell: false`. There is no retry, no failure swallowing, and no signal
// swallowing: the first non-zero status or terminating signal stops the gate.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const GATE_KEYS = ["core", "full", "release"];
const DEFAULT_POLICY_PATH = fileURLToPath(new URL("./test-gate-policy.json", import.meta.url));

export function loadGatePolicy(path = DEFAULT_POLICY_PATH) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return validateGatePolicy(parsed);
}

export function validateGatePolicy(policy) {
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) {
    throw new Error("gate policy must be an object keyed by gate name");
  }
  const keys = Object.keys(policy);
  for (const key of keys) {
    if (!GATE_KEYS.includes(key)) throw new Error(`gate policy has unknown gate "${key}"`);
  }
  for (const gate of GATE_KEYS) {
    const steps = policy[gate];
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error(`gate "${gate}" must be a non-empty array of package script names`);
    }
    if (steps.some((step) => typeof step !== "string" || step.trim() === "")) {
      throw new Error(`gate "${gate}" must contain only non-empty script names`);
    }
    if (new Set(steps).size !== steps.length) {
      throw new Error(`gate "${gate}" contains duplicate script names`);
    }
  }
  for (const step of policy.core) {
    if (!policy.full.includes(step)) throw new Error(`full gate is missing core step "${step}"`);
  }
  for (const step of policy.full) {
    if (!policy.release.includes(step))
      throw new Error(`release gate is missing full step "${step}"`);
  }
  return policy;
}

export function resolveGateSteps(gate, policy) {
  if (!GATE_KEYS.includes(gate)) {
    throw new Error(`unknown gate "${gate}"; expected ${GATE_KEYS.join(" | ")}`);
  }
  return [...policy[gate]];
}

function defaultSpawn(command, args, options) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false,
    ...options,
  });
}

function formatDuration(durationMs) {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function readGitState() {
  const workTree = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
    shell: false,
  });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", shell: false });
  return {
    insideWorkTree: workTree.status === 0 && workTree.stdout.trim() === "true",
    head: head.status === 0 ? head.stdout.trim() : null,
  };
}

function digestPolicyFile(policyPath) {
  return `sha256:${createHash("sha256").update(readFileSync(policyPath)).digest("hex")}`;
}

// Compact command-level gate report: bounded fields only, no environment values
// and no raw logs. Written even when the gate fails so failure evidence survives.
function writeGateReport({ gate, result, startedAt, finishedAt, before, after, overall }) {
  const headChanged = before.head !== after.head;
  const report = {
    schemaVersion: 1,
    gate,
    candidateCommit: before.head,
    headBefore: before.head,
    headAfter: after.head,
    headChanged,
    insideWorkTree: after.insideWorkTree,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    startedAt,
    finishedAt,
    policyDigest: digestPolicyFile(DEFAULT_POLICY_PATH),
    steps: result.steps.map(({ step, status, signal, durationMs }) => ({
      step,
      status,
      signal,
      durationMs,
    })),
    failedStep: result.failedStep,
    overall,
  };
  const dir = join(process.cwd(), "validation-output", "gates");
  mkdirSync(dir, { recursive: true });
  const base = `${startedAt.replace(/[:.]/g, "-")}-${process.pid}`;
  for (let suffix = 0; ; suffix += 1) {
    const path = join(dir, suffix === 0 ? `${base}.json` : `${base}-${suffix}.json`);
    try {
      writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
      return { path, headChanged };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}

export function runGate(
  gate,
  { policy = loadGatePolicy(), spawn = defaultSpawn, log = console.log } = {},
) {
  const steps = resolveGateSteps(gate, policy);
  const results = [];
  const gateStartedAt = Date.now();
  for (const step of steps) {
    log(`\n▶ npm run ${step}`);
    const startedAt = Date.now();
    const outcome = spawn("npm", ["run", step], { shell: false }) ?? {};
    const durationMs = Date.now() - startedAt;
    const status = outcome.status ?? null;
    const signal = outcome.signal ?? null;
    results.push({ step, status, signal, durationMs });
    if (signal) {
      log(`✖ npm run ${step} (${formatDuration(durationMs)}) terminated by ${signal}`);
      return { ok: false, code: 1, signal, failedStep: step, steps: results };
    }
    if (status !== 0) {
      log(`✖ npm run ${step} (${formatDuration(durationMs)}) exited with ${status}`);
      return { ok: false, code: status, signal: null, failedStep: step, steps: results };
    }
    log(`✔ npm run ${step} (${formatDuration(durationMs)})`);
  }
  log(`\n✔ ${gate} gate passed in ${formatDuration(Date.now() - gateStartedAt)}`);
  return { ok: true, code: 0, signal: null, failedStep: null, steps: results };
}

export function handleGateResult(result, { exit = process.exit, kill = process.kill } = {}) {
  if (result.ok) return;
  if (result.signal) {
    kill(process.pid, result.signal);
    return;
  }
  exit(result.code ?? 1);
}

function main(argv) {
  if (argv.includes("--list")) {
    const policy = loadGatePolicy();
    const gate = argv.find((arg) => !arg.startsWith("--"));
    const payload = gate ? { gate, steps: resolveGateSteps(gate, policy) } : policy;
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  const gate = argv[0];
  if (!gate) {
    process.stderr.write("Usage: node scripts/test-gate.mjs <core|full|release> [--list]\n");
    process.exit(1);
  }
  const startedAt = new Date().toISOString();
  const before = readGitState();
  const result = runGate(gate, { policy: loadGatePolicy() });
  const finishedAt = new Date().toISOString();
  const after = readGitState();
  const headChanged = before.head !== after.head;
  const missingHead = after.insideWorkTree && after.head === null;
  const overall = result.ok && !headChanged && !missingHead ? "passed" : "failed";
  const report = writeGateReport({ gate, result, startedAt, finishedAt, before, after, overall });
  console.log(`gate report: ${report.path}`);
  if (headChanged) {
    console.error("::error:: HEAD changed while the gate ran; refusing to report success");
  }
  if (missingHead) {
    console.error("::error:: HEAD could not be resolved inside a git work tree");
  }
  if (result.ok && overall === "failed") process.exit(1);
  handleGateResult(result);
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
  main(process.argv.slice(2));
}
