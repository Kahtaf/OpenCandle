#!/usr/bin/env node
// Merge raw Istanbul coverage maps from separate lanes (root in-process unit run
// and the provider-relay workspace run) without averaging percentages. An
// optional browser lane (scripts/coverage-browser.mjs) can be added over both.
//
// Inputs (absolute source keys, same repo):
//   coverage/unit/coverage-final.json     root lane, includes every configured
//                                         surface (unexecuted files are `all:true`
//                                         placeholders, so full denominators stay)
//   coverage/relay/coverage-final.json    relay lane, executes the two relay sources
//   coverage/browser/coverage-final.json  optional browser lane (--browser)
//
// Output (merged, raw-preserving):
//   coverage/coverage-final.json
//   coverage/coverage-summary.json
//   coverage/lcov.info + coverage/lcov-report/
//
// Usage:
//   node scripts/coverage-merge.mjs [--root <path>] [--relay <path>] [--browser <path>] [--out <dir>] [--repo-root <path>]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createCoverageMap } from "@vitest/istanbul-lib-coverage";
import { create, createContext } from "@vitest/istanbul-lib-report";

// Relay sources are fixed so a config change that drops one is a loud failure
// rather than a silently smaller denominator.
export const RELAY_SOURCE_FILES = [
  "workers/provider-relay/src/relay.ts",
  "workers/provider-relay/src/worker.ts",
];

function assertCount(value, label, { allowNegative = false } = {}) {
  if (!Number.isInteger(value) || (!allowNegative && value < 0)) {
    throw new Error(`coverage lane has a corrupt ${label} counter: ${String(value)}`);
  }
}

// Reject null/NaN/fractional counters and negative statement/function counts
// instead of letting the coverage library coerce them and mask corruption.
// Branch arrays may contain negatives: Vitest's v8 remapper emits them as the
// sentinel for an implicit branch location, so they are permitted here.
function assertValidCounters(raw) {
  for (const [key, file] of Object.entries(raw)) {
    if (
      !file ||
      typeof file !== "object" ||
      typeof file.path !== "string" ||
      file.path.length === 0
    ) {
      throw new Error(`coverage lane has an invalid file entry: ${key}`);
    }
    if (
      !file.s ||
      typeof file.s !== "object" ||
      !file.f ||
      typeof file.f !== "object" ||
      !file.b ||
      typeof file.b !== "object"
    ) {
      throw new Error(`coverage lane has missing counters: ${file.path}`);
    }
    for (const counter of Object.values(file.s)) {
      assertCount(counter, `${file.path} statement`);
    }
    for (const counter of Object.values(file.f)) {
      assertCount(counter, `${file.path} function`);
    }
    for (const branch of Object.values(file.b)) {
      if (!Array.isArray(branch)) {
        throw new Error(`coverage lane has malformed branch counters: ${file.path}`);
      }
      for (const counter of branch) {
        assertCount(counter, `${file.path} branch`, { allowNegative: true });
      }
    }
  }
}

/** Load a coverage-final.json lane, rejecting missing, corrupt, or empty input. */
export function loadCoverageMap(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`coverage lane missing: ${filePath}`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`coverage lane is not valid JSON: ${filePath} (${error.message})`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`coverage lane is not a coverage map: ${filePath}`);
  }
  assertValidCounters(raw);
  const map = createCoverageMap(raw);
  if (map.files().length === 0) {
    throw new Error(`coverage lane has no files: ${filePath}`);
  }
  return map;
}

/**
 * Require the two relay sources to be present in a lane with valid, in-repo
 * paths and at least one executed line. 100% coverage is valid: the
 * executed/unexecuted source-line mapping was proven once at merge time, and
 * production is not required to stay uncovered.
 */
export function verifyRelayCoverage(map, { repoRoot = process.cwd() } = {}) {
  const rootAbs = resolve(repoRoot);
  const byResolvedPath = new Map(map.files().map((path) => [resolve(path), path]));
  const files = [];
  let statementCount = 0;
  let coveredLines = 0;
  let uncoveredLines = 0;

  for (const relPath of RELAY_SOURCE_FILES) {
    const absPath = resolve(rootAbs, relPath);
    const relativePath = relative(rootAbs, absPath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error(`relay source escapes the repo: ${relPath}`);
    }
    const coverageKey = byResolvedPath.get(absPath);
    if (!coverageKey) {
      throw new Error(`relay coverage is missing expected relay source: ${relPath}`);
    }
    if (!existsSync(absPath)) {
      throw new Error(`relay source not found on disk: ${relPath}`);
    }
    const fileCoverage = map.fileCoverageFor(coverageKey);
    statementCount += Object.keys(fileCoverage.statementMap).length;
    const sourceLines = readFileSync(absPath, "utf8").split(/\r?\n/).length;
    let fileCovered = 0;
    let fileUncovered = 0;
    for (const [line, hits] of Object.entries(fileCoverage.getLineCoverage())) {
      const lineNumber = Number(line);
      if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > sourceLines) {
        throw new Error(`relay source-map line ${line} out of range for ${relPath}`);
      }
      if (hits > 0) {
        fileCovered += 1;
        coveredLines += 1;
      } else {
        fileUncovered += 1;
        uncoveredLines += 1;
      }
    }
    files.push({ file: relPath, coveredLines: fileCovered, uncoveredLines: fileUncovered });
  }

  if (statementCount === 0) {
    throw new Error("relay coverage is empty: no statements in the expected relay sources");
  }
  if (coveredLines === 0) {
    throw new Error("no executed relay source line in relay coverage");
  }
  return { files, coveredLines, uncoveredLines };
}

/** Build a stable source-location key for istanbul statement/function/branch maps. */
function locationKey(location) {
  if (!location?.start || !location.end) {
    return null;
  }
  const { start, end } = location;
  if (typeof start.line !== "number" || typeof end.line !== "number") {
    return null;
  }
  return `${start.line}|${start.column ?? 0}|${end.line}|${end.column ?? 0}`;
}

function coveredLocations(fileCoverage, metric) {
  const covered = new Map();
  if (metric === "statements") {
    for (const [id, location] of Object.entries(fileCoverage.statementMap)) {
      const key = locationKey(location);
      const hits = fileCoverage.s[id] ?? 0;
      if (key && hits > 0) covered.set(key, hits);
    }
  } else if (metric === "functions") {
    for (const [id, fn] of Object.entries(fileCoverage.fnMap)) {
      const key = locationKey(fn.loc);
      const hits = fileCoverage.f[id] ?? 0;
      if (key && hits > 0) covered.set(key, hits);
    }
  } else {
    for (const [id, branch] of Object.entries(fileCoverage.branchMap)) {
      const hits = fileCoverage.b[id] ?? [];
      branch.locations.forEach((location, index) => {
        const key = locationKey(location);
        if (key && (hits[index] ?? 0) > 0) covered.set(key, hits[index]);
      });
    }
  }
  return covered;
}

/**
 * Verify that a browser-merged map retains every positive Node hit by actual
 * source location (not just per-surface aggregates): statements, functions,
 * branches, and lines. Returns a list of human-readable violations.
 */
export function verifyNodeHitsRetained(nodeMap, mergedMap, { repoRoot = process.cwd() } = {}) {
  const violations = [];
  const mergedFiles = new Set(mergedMap.files());
  for (const file of nodeMap.files()) {
    const label = relative(repoRoot, file) || file;
    if (!mergedFiles.has(file)) {
      violations.push(`${label}: file missing from merged coverage`);
      continue;
    }
    const node = nodeMap.fileCoverageFor(file);
    const merged = mergedMap.fileCoverageFor(file);
    for (const metric of ["statements", "functions", "branches"]) {
      const mergedCovered = coveredLocations(merged, metric);
      for (const [key, hits] of coveredLocations(node, metric)) {
        if (!(mergedCovered.get(key) > 0)) {
          violations.push(
            `${label}: ${metric} ${key.replaceAll("|", ":")} positive in node (${hits}) but not in merged`,
          );
        }
      }
    }
    const nodeLines = node.getLineCoverage();
    const mergedLines = merged.getLineCoverage();
    for (const [line, hits] of Object.entries(nodeLines)) {
      if (hits > 0 && !(mergedLines[line] > 0)) {
        violations.push(`${label}: line ${line} positive in node (${hits}) but not in merged`);
      }
    }
  }
  return violations;
}

/**
 * Verify the relay lane itself, then merge it over the root lane. Verifying
 * before merging is required: the root lane carries `all:true` placeholders for
 * both relay files, so a relay lane that dropped one file would otherwise look
 * present in the merged map.
 *
 * `browserPath` is optional. When set, the browser lane's raw Istanbul map
 * (from scripts/coverage-browser.mjs) is merged in by source location and raw
 * hit counts: node hits are summed with browser hits, never overwritten or
 * averaged, and no root file is removed. Line/statement maps come from the same
 * ast-v8-to-istanbul converter, but branch maps may differ between the V8 lanes,
 * so merged branch totals are a location merge, not a claim of identical branch
 * semantics. The merge fails if any positive Node hit is lost by location.
 */
export function mergeLanes({
  rootPath,
  relayPath,
  browserPath = null,
  repoRoot = process.cwd(),
} = {}) {
  const root = loadCoverageMap(resolve(repoRoot, rootPath));
  const relay = loadCoverageMap(resolve(repoRoot, relayPath));
  const verdict = verifyRelayCoverage(relay, { repoRoot });
  const merged = createCoverageMap(JSON.parse(JSON.stringify(root.toJSON())));
  merged.merge(relay);

  let browser = null;
  if (browserPath) {
    const browserAbs = resolve(repoRoot, browserPath);
    const browserMap = loadCoverageMap(browserAbs);
    const nodeMerged = createCoverageMap(JSON.parse(JSON.stringify(merged.toJSON())));
    merged.merge(browserMap);
    const lost = verifyNodeHitsRetained(nodeMerged, merged, { repoRoot });
    if (lost.length > 0) {
      throw new Error(
        `browser merge lost positive node hits:\n${lost.slice(0, 10).join("\n")}${
          lost.length > 10 ? `\n...and ${lost.length - 10} more` : ""
        }`,
      );
    }
    browser = { path: browserAbs, files: browserMap.files().length };
  }
  return { merged, verdict, browser };
}

/** Write the merged raw map plus coverage-summary.json and lcov from it. */
export function writeMergedReports(map, { dir = "coverage", repoRoot = process.cwd() } = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "coverage-final.json"), `${JSON.stringify(map.toJSON())}\n`, "utf8");
  const context = createContext({ coverageMap: map, dir });
  create("json-summary", { file: "coverage-summary.json" }).execute(context);
  create("lcov", { file: "lcov.info", projectRoot: repoRoot }).execute(context);
}

/** Merge both lanes, verify the relay lane, and write merged reports. */
export function runCoverageMerge({
  rootPath = join("coverage", "unit", "coverage-final.json"),
  relayPath = join("coverage", "relay", "coverage-final.json"),
  browserPath = null,
  outDir = "coverage",
  repoRoot = process.cwd(),
} = {}) {
  const { merged, verdict, browser } = mergeLanes({ rootPath, relayPath, browserPath, repoRoot });
  writeMergedReports(merged, {
    dir: isAbsolute(outDir) ? outDir : resolve(repoRoot, outDir),
    repoRoot,
  });
  return { verdict, browser, totals: merged.getCoverageSummary().toJSON() };
}

/** Parse command-line options for the merge CLI. */
export function parseArgs(argv) {
  const options = {
    rootPath: join("coverage", "unit", "coverage-final.json"),
    relayPath: join("coverage", "relay", "coverage-final.json"),
    browserPath: null,
    outDir: "coverage",
    repoRoot: process.cwd(),
  };
  const next = () => {
    index += 1;
    return argv[index];
  };
  let index = 0;
  while (index < argv.length) {
    switch (argv[index]) {
      case "--root":
        options.rootPath = next();
        break;
      case "--relay":
        options.relayPath = next();
        break;
      case "--browser":
        options.browserPath = next();
        break;
      case "--out":
        options.outDir = next();
        break;
      case "--repo-root":
        options.repoRoot = next();
        break;
      default:
        throw new Error(`unknown option: ${argv[index]}`);
    }
    index += 1;
  }
  return options;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  try {
    const { verdict, browser, totals } = runCoverageMerge(options);
    console.log(`merged relay lanes: ${verdict.files.map((entry) => entry.file).join(", ")}`);
    console.log(
      `relay source lines: ${verdict.coveredLines} covered / ${verdict.uncoveredLines} uncovered`,
    );
    if (browser) {
      console.log(`merged browser lane: ${browser.files} file(s) from ${browser.path}`);
    }
    console.log(
      `merged totals: lines ${totals.lines.covered}/${totals.lines.total}, ` +
        `functions ${totals.functions.covered}/${totals.functions.total}, ` +
        `branches ${totals.branches.covered}/${totals.branches.total}`,
    );
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invokedPath || process.argv[1]?.endsWith("coverage-merge.mjs")) {
  main();
}
