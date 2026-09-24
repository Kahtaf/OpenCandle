#!/usr/bin/env node
// Phase 1 executable test inventory generator.
//
// Usage:
//   node scripts/test-inventory.mjs                 collect + write validation-output/test-inventory.json
//   node scripts/test-inventory.mjs --stdout        collect + print JSON, write nothing (read-only)
//   node scripts/test-inventory.mjs --routes        print the route registry, write nothing (read-only)
//   node scripts/test-inventory.mjs --check <file>  validate an existing inventory, write nothing (read-only)
//   node scripts/test-inventory.mjs --from <dir>    read captured per-route JSON instead of spawning vitest
//   node scripts/test-inventory.mjs --out <file>    override the output path (must stay under validation-output/)
//   node scripts/test-inventory.mjs --force         allow overwriting a non-inventory JSON under validation-output/
//
// This script never runs a test body and never calls a live API. Eval, GUI
// browser, and GUI release suites are collected with `--staticParse=false`
// because their `it()` calls are registered dynamically/behind env gates;
// `vitest list` still only collects, it does not execute.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_ROUTES,
  assertNoSecretLikeValues,
  buildCollectionEnv,
  buildInventory,
  deriveRouteGateMembership,
  EVAL_ENV_VARIANTS,
  GATE_POLICY_PATH,
  loadGatePolicy,
  STATIC_ROUTES,
  VITEST_ROUTES,
  validateInventory,
  validateOutputTarget,
} from "./test-inventory-lib.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_SPAWN_TIMEOUT_MS = 600_000;

function loadPolicyFromRepo() {
  const path = resolve(repoRoot, GATE_POLICY_PATH);
  const text = readFileSync(path, "utf8");
  const digest = `sha256:${createHash("sha256").update(text).digest("hex")}`;
  return { policy: loadGatePolicy(text), digest };
}

function parseArgs(argv) {
  const options = {
    mode: "collect",
    out: "validation-output/test-inventory.json",
    from: null,
    force: false,
    checkPath: null,
    timeoutMs: DEFAULT_SPAWN_TIMEOUT_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.mode = "help";
    else if (arg === "--routes") options.mode = "routes";
    else if (arg === "--stdout") options.mode = "stdout";
    else if (arg === "--check") {
      options.mode = "check";
      options.checkPath = argv[index + 1];
      index += 1;
    } else if (arg === "--from") {
      options.from = argv[index + 1];
      index += 1;
    } else if (arg === "--out") {
      options.out = argv[index + 1];
      index += 1;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number.parseInt(argv[index + 1], 10);
      if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
        throw new Error("--timeout-ms requires a positive integer");
      }
      index += 1;
    } else if (arg === "--force") options.force = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`OpenCandle test inventory (Phase 1)

  node scripts/test-inventory.mjs                 collect + write validation-output/test-inventory.json
  node scripts/test-inventory.mjs --stdout        collect + print JSON, write nothing
  node scripts/test-inventory.mjs --routes        print the route registry + derived gate membership
  node scripts/test-inventory.mjs --check <file>  validate an existing inventory
  node scripts/test-inventory.mjs --from <dir>    read captured per-route JSON instead of spawning
  node scripts/test-inventory.mjs --out <file>    output path under validation-output/
  node scripts/test-inventory.mjs --timeout-ms <n> per-spawn timeout in ms (default ${DEFAULT_SPAWN_TIMEOUT_MS})
  node scripts/test-inventory.mjs --force         allow overwriting a non-inventory target

Gate membership is derived from ${GATE_POLICY_PATH} (read-only, owned by the
gate workstream), not stored in the route registry. Incomplete collection makes
the command exit non-zero even though the partial JSON is still written to
validation-output/ for diagnosis.`);
}

function printRoutes(policy) {
  for (const route of ALL_ROUTES) {
    const membership = deriveRouteGateMembership(route, policy);
    const gates = membership.gates.length > 0 ? membership.gates.join(",") : "no-gate";
    const commands = membership.gateCommands.join("; ");
    console.log(
      `${route.id}\t${route.collector}\t${route.collectionMode}\t${membership.nature}\t${gates}\t${commands}`,
    );
  }
}

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function expandPattern(pattern) {
  const slash = pattern.lastIndexOf("/");
  const dir = pattern.slice(0, slash);
  const base = pattern.slice(slash + 1);
  const matcher = wildcardToRegExp(base);
  let entries;
  try {
    entries = readdirSync(resolve(repoRoot, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && matcher.test(entry.name))
    .map((entry) => `${dir}/${entry.name}`)
    .sort();
}

function collectStaticFiles() {
  const files = [];
  for (const route of STATIC_ROUTES) {
    const excluded = new Set(route.staticExclude ?? []);
    for (const pattern of route.staticPatterns ?? []) {
      for (const file of expandPattern(pattern)) {
        if (!excluded.has(file)) files.push({ routeId: route.id, file });
      }
    }
  }
  return files;
}

function runVitestList(route, env, timeoutMs) {
  const args = ["vitest", "list", "--json"];
  if (route.project) args.push("--project", route.project);
  if (route.collectionMode === "runtime") args.push("--staticParse=false");
  const cwd = route.cwd ? resolve(repoRoot, route.cwd) : repoRoot;
  const result = spawnSync("npx", args, {
    cwd,
    env: buildCollectionEnv(process.env, route.env ?? {}, env),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  if (result.error) {
    const timedOut = result.error.code === "ETIMEDOUT";
    return {
      error: timedOut
        ? `vitest list timed out after ${timeoutMs}ms`
        : `spawn failed: ${result.error.message}`,
      cases: [],
    };
  }
  if (result.signal) return { error: `vitest list killed by ${result.signal}`, cases: [] };
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim().split("\n").slice(-3).join(" | ");
    return { error: `vitest list exited ${result.status}: ${stderr}`, cases: [] };
  }
  try {
    return { cases: JSON.parse(result.stdout) };
  } catch (error) {
    return { error: `vitest json parse failed: ${error.message}`, cases: [] };
  }
}

function readCollectionFile(path) {
  try {
    return { cases: JSON.parse(readFileSync(path, "utf8")) };
  } catch (error) {
    return { error: `cannot read captured collection ${path}: ${error.message}`, cases: [] };
  }
}

function collect({ from, timeoutMs }) {
  const collections = [];
  for (const route of VITEST_ROUTES) {
    if (route.id === "evals") {
      for (const variant of EVAL_ENV_VARIANTS) {
        const result = from
          ? readCollectionFile(resolve(from, `evals.${variant.id}.json`))
          : runVitestList(route, variant.env, timeoutMs);
        collections.push({
          routeId: route.id,
          variantId: variant.id,
          env: variant.env,
          ...result,
        });
      }
      continue;
    }
    const result = from
      ? readCollectionFile(resolve(from, `${route.id}.json`))
      : runVitestList(route, {}, timeoutMs);
    collections.push({ routeId: route.id, variantId: "default", env: {}, ...result });
  }
  return { collections, staticFiles: collectStaticFiles() };
}

function readRepoFile(file) {
  return readFileSync(resolve(repoRoot, file), "utf8");
}

function build({ from, timeoutMs, policy, policyDigest }) {
  const { collections, staticFiles } = collect({ from, timeoutMs });
  const generatedAt = new Date().toISOString();
  const inventory = buildInventory({
    collections,
    staticFiles,
    repoRoot,
    generatedAt,
    readFile: readRepoFile,
    policy,
    policyDigest,
  });
  const validation = validateInventory(inventory, { policy });
  return { inventory, validation };
}

function writeInventory(inventory, out, force) {
  const target = validateOutputTarget(out, { repoRoot, force });
  if (!target.ok) throw new Error(`unsafe output target: ${target.reason}`);
  const text = `${JSON.stringify(inventory, null, 2)}\n`;
  const secrets = assertNoSecretLikeValues(text);
  if (!secrets.ok) {
    throw new Error(`refusing to write secret-like values: ${secrets.findings.join(", ")}`);
  }
  mkdirSync(dirname(target.path), { recursive: true });
  writeFileSync(target.path, text);
  return target.path;
}

function checkInventory(path, policy) {
  const raw = readFileSync(path, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid JSON: ${error.message}`);
  }
  const validation = validateInventory(parsed, { policy });
  const secrets = assertNoSecretLikeValues(raw);
  if (validation.errors.length > 0 || !secrets.ok) {
    const reasons = [...validation.errors, ...secrets.findings.map((f) => `secret-like:${f}`)];
    throw new Error(`inventory check failed: ${reasons.join(", ")}`);
  }
  const cases = parsed.totals?.collectedCases ?? parsed.cases?.length ?? 0;
  console.log(`ok: ${path} (${cases} cases, ${parsed.routes?.length ?? 0} routes)`);
}

function summarize(inventory) {
  console.log(
    `inventory: ${inventory.totals.collectedCases} cases across ${inventory.totals.collectedFiles} files, ` +
      `${inventory.totals.staticEntries} static entries, ${inventory.totals.routes} routes`,
  );
  for (const route of inventory.routes) {
    const gates = route.gateNames.length > 0 ? route.gateNames.join(",") : "no-gate";
    const error = route.errors.length > 0 ? ` ERROR ${route.errors.join("; ")}` : "";
    console.log(
      `  ${route.id}: ${route.caseCount} cases (${route.collectionMode}, ${route.nature}, ${gates})${error}`,
    );
  }
}

function reportValidationErrors(validation) {
  if (validation.ok) return;
  console.error(`inventory incomplete (${validation.errors.length} problem(s)):`);
  for (const error of validation.errors) console.error(`  ${error}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "help") {
    printHelp();
    return 0;
  }
  const { policy, digest } = loadPolicyFromRepo();
  if (options.mode === "routes") {
    printRoutes(policy);
    return 0;
  }
  if (options.mode === "check") {
    if (!options.checkPath) throw new Error("--check requires a path");
    checkInventory(options.checkPath, policy);
    return 0;
  }
  const { inventory, validation } = build({
    from: options.from,
    timeoutMs: options.timeoutMs,
    policy,
    policyDigest: digest,
  });
  if (options.mode === "stdout") {
    console.log(JSON.stringify(inventory, null, 2));
    reportValidationErrors(validation);
    return validation.ok ? 0 : 1;
  }
  const target = writeInventory(inventory, options.out, options.force);
  summarize(inventory);
  console.log(`wrote ${target}`);
  if (!validation.ok) {
    reportValidationErrors(validation);
    return 1;
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
