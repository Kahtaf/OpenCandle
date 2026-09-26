import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCoverageMap } from "@vitest/istanbul-lib-coverage";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadCoverageMap,
  mergeLanes,
  RELAY_SOURCE_FILES,
  verifyNodeHitsRetained,
  verifyRelayCoverage,
  writeMergedReports,
} from "../../scripts/coverage-merge.mjs";
import { summarizeCoverage } from "../../scripts/coverage-report.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const tempRoots: string[] = [];

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "opencandle-merge-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeSource(root: string, relPath: string, lineCount: number): string {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(
    abs,
    `${Array.from({ length: lineCount }, (_, index) => `export const line${index + 1} = ${index + 1};`).join("\n")}\n`,
  );
  return abs;
}

function rawCoverage(
  path: string,
  lines: Record<number, number>,
  all = false,
): Record<string, unknown> {
  const statementMap: Record<string, unknown> = {};
  const s: Record<string, number> = {};
  for (const [line, hits] of Object.entries(lines)) {
    statementMap[line] = {
      start: { line: Number(line), column: 0 },
      end: { line: Number(line), column: 10 },
    };
    s[line] = hits;
  }
  return { path, all, statementMap, fnMap: {}, branchMap: {}, s, f: {}, b: {} };
}

function writeCoverageLane(filePath: string, entries: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(entries));
}

function lanePaths(root: string) {
  return {
    rootPath: join(root, "coverage", "unit", "coverage-final.json"),
    relayPath: join(root, "coverage", "relay", "coverage-final.json"),
  };
}

// A repo fixture with the two real relay sources plus one root-only source.
function relayRepo() {
  const root = makeRepo();
  const rootSource = writeSource(root, "src/core.ts", 10);
  const relaySource = writeSource(root, RELAY_SOURCE_FILES[0], 10);
  const workerSource = writeSource(root, RELAY_SOURCE_FILES[1], 10);
  return { root, rootSource, relaySource, workerSource };
}

function rootPlaceholders(relaySource: string, workerSource: string) {
  return {
    [relaySource]: rawCoverage(relaySource, { 1: 0, 2: 0 }, true),
    [workerSource]: rawCoverage(workerSource, { 1: 0 }, true),
  };
}

describe("coverage-merge inputs", () => {
  it("rejects a missing, corrupt, or empty lane file", () => {
    const root = makeRepo();
    const missing = join(root, "nope.json");
    expect(() => loadCoverageMap(missing)).toThrow(/missing/i);

    const corrupt = join(root, "corrupt.json");
    writeFileSync(corrupt, "{not json");
    expect(() => loadCoverageMap(corrupt)).toThrow(/valid JSON/i);

    const empty = join(root, "empty.json");
    writeFileSync(empty, "{}");
    expect(() => loadCoverageMap(empty)).toThrow(/no files/i);
  });

  it("rejects null, negative, and fractional counters instead of masking corruption", () => {
    const { root, relaySource } = relayRepo();
    const file = join(root, "counters.json");
    for (const bad of [null, -1, 1.5]) {
      writeCoverageLane(file, {
        [relaySource]: { ...rawCoverage(relaySource, { 1: 0 }), s: { 1: bad } },
      });
      expect(() => loadCoverageMap(file), String(bad)).toThrow(/corrupt .* counter/i);
    }
  });

  it("permits the negative branch sentinel Vitest emits for implicit branches", () => {
    const { root, relaySource } = relayRepo();
    const file = join(root, "sentinel.json");
    writeCoverageLane(file, {
      [relaySource]: { ...rawCoverage(relaySource, { 1: 0 }), b: { 0: [10, -6] } },
    });
    expect(() => loadCoverageMap(file)).not.toThrow();
  });

  it("fails when one lane is absent", () => {
    const { root } = relayRepo();
    const { rootPath, relayPath } = lanePaths(root);
    const coreSource = join(root, "src/core.ts");
    writeCoverageLane(rootPath, { [coreSource]: rawCoverage(coreSource, { 1: 0 }, true) });
    expect(() => mergeLanes({ rootPath, relayPath, repoRoot: root })).toThrow(/missing/i);
  });
});

describe("mergeLanes", () => {
  it("merges relay execution over the root placeholder without losing the denominator", () => {
    const { root, rootSource, relaySource, workerSource } = relayRepo();
    const { rootPath, relayPath } = lanePaths(root);

    writeCoverageLane(rootPath, {
      [rootSource]: rawCoverage(rootSource, { 1: 0, 2: 0 }, true),
      [relaySource]: rawCoverage(relaySource, { 1: 0, 2: 0, 3: 0 }, true),
    });
    writeCoverageLane(relayPath, {
      [relaySource]: rawCoverage(relaySource, { 1: 4, 2: 0, 3: 2 }),
      [workerSource]: rawCoverage(workerSource, { 1: 1 }),
    });

    const { merged, verdict } = mergeLanes({ rootPath, relayPath, repoRoot: root });
    const relay = merged.fileCoverageFor(relaySource).toSummary();
    const core = merged.fileCoverageFor(rootSource).toSummary();

    // Relay hits are added; the root-only file keeps its full 0/2 denominator.
    expect(relay.lines).toMatchObject({ covered: 2, total: 3 });
    expect(core.lines).toMatchObject({ covered: 0, total: 2 });

    // This fixture is the one-time executed/unexecuted source-map proof: both
    // kinds of source line are present and mapped to real line numbers.
    expect(verdict.coveredLines).toBeGreaterThan(0);
    expect(verdict.uncoveredLines).toBeGreaterThan(0);
  });
});

describe("verifyRelayCoverage", () => {
  it("permits a fully covered relay lane and merges it", () => {
    const { root, relaySource, workerSource } = relayRepo();
    const { rootPath, relayPath } = lanePaths(root);
    writeCoverageLane(rootPath, rootPlaceholders(relaySource, workerSource));
    writeCoverageLane(relayPath, {
      [relaySource]: rawCoverage(relaySource, { 1: 1, 2: 1 }),
      [workerSource]: rawCoverage(workerSource, { 1: 1 }),
    });

    const relay = loadCoverageMap(relayPath);
    const verdict = verifyRelayCoverage(relay, { repoRoot: root });
    expect(verdict.coveredLines).toBe(3);
    expect(verdict.uncoveredLines).toBe(0);

    const { merged } = mergeLanes({ rootPath, relayPath, repoRoot: root });
    expect(merged.fileCoverageFor(relaySource).toSummary().lines).toMatchObject({
      covered: 2,
      total: 2,
    });
  });

  it("fails when the relay lane drops a file even though the root placeholder exists", () => {
    const { root, relaySource, workerSource } = relayRepo();
    const { rootPath, relayPath } = lanePaths(root);
    // Root carries `all:true` placeholders for both relay files, as in the real run.
    writeCoverageLane(rootPath, rootPlaceholders(relaySource, workerSource));
    writeCoverageLane(relayPath, {
      [relaySource]: rawCoverage(relaySource, { 1: 1, 2: 0 }),
    });

    expect(() => mergeLanes({ rootPath, relayPath, repoRoot: root })).toThrow(
      /missing expected relay source.*worker/i,
    );
  });

  it("rejects source-map lines outside the real file and missing relay sources on disk", () => {
    const { root, relaySource, workerSource } = relayRepo();
    const { rootPath, relayPath } = lanePaths(root);

    writeCoverageLane(rootPath, rootPlaceholders(relaySource, workerSource));
    writeCoverageLane(relayPath, {
      [relaySource]: rawCoverage(relaySource, { 1: 1, 999: 0 }),
      [workerSource]: rawCoverage(workerSource, { 1: 1 }),
    });
    const relay = loadCoverageMap(relayPath);
    expect(() => verifyRelayCoverage(relay, { repoRoot: root })).toThrow(/out of range/i);

    rmSync(relaySource);
    expect(() => verifyRelayCoverage(relay, { repoRoot: root })).toThrow(/not found on disk/i);
  });
});

describe("writeMergedReports", () => {
  it("writes merged summary, lcov, and raw map from the merged coverage", () => {
    const { root, relaySource, workerSource } = relayRepo();
    const { rootPath, relayPath } = lanePaths(root);
    writeCoverageLane(rootPath, rootPlaceholders(relaySource, workerSource));
    writeCoverageLane(relayPath, {
      [relaySource]: rawCoverage(relaySource, { 1: 2, 2: 0 }),
      [workerSource]: rawCoverage(workerSource, { 1: 1 }),
    });
    const { merged } = mergeLanes({ rootPath, relayPath, repoRoot: root });
    const outDir = join(root, "coverage");

    writeMergedReports(merged, { dir: outDir, repoRoot: root });

    expect(existsSync(join(outDir, "coverage-summary.json"))).toBe(true);
    expect(existsSync(join(outDir, "lcov.info"))).toBe(true);
    expect(existsSync(join(outDir, "coverage-final.json"))).toBe(true);

    const summary = JSON.parse(readFileSync(join(outDir, "coverage-summary.json"), "utf8"));
    expect(summary[relaySource].lines).toMatchObject({ covered: 1, total: 2 });
    const lcov = readFileSync(join(outDir, "lcov.info"), "utf8");
    expect(lcov).toContain("workers/provider-relay/src/relay.ts");
    expect(lcov).toContain("DA:1,2");
    expect(lcov).toContain("DA:2,0");
  });

  it("fails the command line when a lane is missing and succeeds when both exist", () => {
    const { root, relaySource, workerSource } = relayRepo();
    const { rootPath, relayPath } = lanePaths(root);
    writeCoverageLane(rootPath, { [relaySource]: rawCoverage(relaySource, { 1: 0, 2: 0 }, true) });
    writeCoverageLane(relayPath, {
      [relaySource]: rawCoverage(relaySource, { 1: 2, 2: 0 }),
      [workerSource]: rawCoverage(workerSource, { 1: 1 }),
    });

    const script = resolve(repoRoot, "scripts/coverage-merge.mjs");
    const run = (args: string[]) =>
      spawnSync(process.execPath, [script, "--repo-root", root, ...args], { encoding: "utf8" });

    const ok = run(["--root", rootPath, "--relay", relayPath, "--out", join(root, "coverage")]);
    expect(ok.status, ok.stderr).toBe(0);

    const missing = run([
      "--root",
      join(root, "coverage", "nope.json"),
      "--relay",
      relayPath,
      "--out",
      join(root, "coverage"),
    ]);
    expect(missing.status).toBe(2);
    expect(`${missing.stdout}${missing.stderr}`).toMatch(/missing/i);
  });
});

function webRepo() {
  const root = makeRepo();
  return {
    root,
    core: writeSource(root, "src/core.ts", 10),
    relaySource: writeSource(root, RELAY_SOURCE_FILES[0], 10),
    workerSource: writeSource(root, RELAY_SOURCE_FILES[1], 10),
    app: writeSource(root, "gui/web/src/App.jsx", 10),
    button: writeSource(root, "packages/ui/src/button.jsx", 10),
  };
}

const WEB_EXPECTED = [
  "src/core.ts",
  "gui/web/src/App.jsx",
  "packages/ui/src/button.jsx",
  RELAY_SOURCE_FILES[0],
  RELAY_SOURCE_FILES[1],
];

function writeNodeAndRelay(base: ReturnType<typeof webRepo>) {
  const { rootPath, relayPath } = lanePaths(base.root);
  writeCoverageLane(rootPath, {
    [base.core]: rawCoverage(base.core, { 1: 3, 2: 0 }),
    [base.app]: rawCoverage(base.app, { 1: 0, 2: 0 }, true),
    [base.button]: rawCoverage(base.button, { 1: 0 }, true),
    [base.relaySource]: rawCoverage(base.relaySource, { 1: 0, 2: 0 }, true),
    [base.workerSource]: rawCoverage(base.workerSource, { 1: 0 }, true),
  });
  writeCoverageLane(relayPath, {
    [base.relaySource]: rawCoverage(base.relaySource, { 1: 1, 2: 0 }),
    [base.workerSource]: rawCoverage(base.workerSource, { 1: 1 }),
  });
  return { rootPath, relayPath };
}

function writeBrowser(base: ReturnType<typeof webRepo>) {
  const browserPath = join(base.root, "coverage", "browser", "coverage-final.json");
  writeCoverageLane(browserPath, {
    [base.core]: rawCoverage(base.core, { 1: 4, 2: 0 }),
    [base.app]: rawCoverage(base.app, { 1: 5, 2: 0 }),
    [base.button]: rawCoverage(base.button, { 1: 2 }),
  });
  return browserPath;
}

describe("optional browser lane merge", () => {
  it("sums browser hits over node+relay without overwriting node hits or shrinking the denominator", () => {
    const base = webRepo();
    const { rootPath, relayPath } = writeNodeAndRelay(base);
    const browserPath = writeBrowser(base);

    const { merged, browser } = mergeLanes({
      rootPath,
      relayPath,
      browserPath,
      repoRoot: base.root,
    });
    expect(browser?.files).toBe(3);

    // Overlapping source: node hits (3) plus browser hits (4), never overwritten.
    expect(merged.fileCoverageFor(base.core).getLineCoverage()).toMatchObject({ 1: 7, 2: 0 });
    // Browser-only files become executed.
    expect(merged.fileCoverageFor(base.app).toSummary().lines).toMatchObject({
      covered: 1,
      total: 2,
    });
    expect(merged.fileCoverageFor(base.button).toSummary().lines).toMatchObject({
      covered: 1,
      total: 1,
    });
    // Full root denominator stays present.
    expect(merged.files().sort()).toEqual(
      [base.app, base.button, base.core, base.relaySource, base.workerSource].sort(),
    );
    // Raw totals, no percentage averaging: 5 of 8 lines covered.
    expect(merged.getCoverageSummary().toJSON().lines).toMatchObject({ covered: 5, total: 8 });
  });

  it("treats browser surfaces as measured only once browser hits are merged", () => {
    const base = webRepo();
    const { rootPath, relayPath } = writeNodeAndRelay(base);
    const outDir = join(base.root, "coverage");

    const withoutBrowser = mergeLanes({ rootPath, relayPath, repoRoot: base.root }).merged;
    writeMergedReports(withoutBrowser, { dir: outDir, repoRoot: base.root });
    const before = summarizeCoverage({
      summary: JSON.parse(readFileSync(join(outDir, "coverage-summary.json"), "utf8")),
      expectedFiles: WEB_EXPECTED,
      repoRoot: base.root,
    });
    expect(before.surfaces.find((surface) => surface.id === "gui-web")?.measured).toBe(false);
    expect(before.surfaces.find((surface) => surface.id === "ui-package")?.measured).toBe(false);
    expect(before.surfaces.find((surface) => surface.id === "core")?.measured).toBe(true);

    const browserPath = writeBrowser(base);
    const withBrowser = mergeLanes({
      rootPath,
      relayPath,
      browserPath,
      repoRoot: base.root,
    }).merged;
    writeMergedReports(withBrowser, { dir: outDir, repoRoot: base.root });
    const after = summarizeCoverage({
      summary: JSON.parse(readFileSync(join(outDir, "coverage-summary.json"), "utf8")),
      expectedFiles: WEB_EXPECTED,
      repoRoot: base.root,
    });
    expect(after.surfaces.find((surface) => surface.id === "gui-web")?.measured).toBe(true);
    expect(after.surfaces.find((surface) => surface.id === "ui-package")?.measured).toBe(true);
    // The in-process core count is not dropped by the browser merge.
    expect(after.surfaces.find((surface) => surface.id === "core")?.totals.lines).toMatchObject({
      covered: 1,
      total: 2,
    });
  });

  it("fails when a requested browser lane is missing", () => {
    const base = webRepo();
    const { rootPath, relayPath } = writeNodeAndRelay(base);
    expect(() =>
      mergeLanes({
        rootPath,
        relayPath,
        browserPath: join(base.root, "coverage", "browser", "nope.json"),
        repoRoot: base.root,
      }),
    ).toThrow(/missing/i);
  });

  it("merges the browser lane from the command line and fails when it is absent", () => {
    const base = webRepo();
    const { rootPath, relayPath } = writeNodeAndRelay(base);
    const browserPath = writeBrowser(base);
    const script = resolve(repoRoot, "scripts/coverage-merge.mjs");
    const run = (browser: string) =>
      spawnSync(
        process.execPath,
        [
          script,
          "--repo-root",
          base.root,
          "--root",
          rootPath,
          "--relay",
          relayPath,
          "--browser",
          browser,
          "--out",
          join(base.root, "coverage"),
        ],
        { encoding: "utf8" },
      );

    const ok = run(browserPath);
    expect(ok.status, ok.stderr).toBe(0);

    const missing = run(join(base.root, "coverage", "browser", "nope.json"));
    expect(missing.status).toBe(2);
    expect(`${missing.stdout}${missing.stderr}`).toMatch(/missing/i);
  });
});

describe("node hit retention across a browser merge", () => {
  it("flags a positive node statement location that the merged map dropped", () => {
    const root = makeRepo();
    const source = writeSource(root, "src/core.ts", 10);
    const node = createCoverageMap({ [source]: rawCoverage(source, { 1: 3, 2: 0 }) });
    // Tampered merge: the node's line-1 statement location is gone.
    const dropped = createCoverageMap({ [source]: rawCoverage(source, { 2: 5 }) });

    const violations = verifyNodeHitsRetained(node, dropped, { repoRoot: root });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join("\n")).toMatch(/statement/i);
    expect(violations.join("\n")).toMatch(/line 1/i);
  });

  it("retains every positive node location and the full denominator when browser hits merge", () => {
    const base = webRepo();
    const { rootPath, relayPath } = writeNodeAndRelay(base);
    const browserPath = writeBrowser(base);
    const nodeMerged = mergeLanes({ rootPath, relayPath, repoRoot: base.root }).merged;
    const { merged } = mergeLanes({ rootPath, relayPath, browserPath, repoRoot: base.root });

    expect(verifyNodeHitsRetained(nodeMerged, merged, { repoRoot: base.root })).toEqual([]);
    for (const file of nodeMerged.files()) {
      const nodeTotal = Object.keys(nodeMerged.fileCoverageFor(file).statementMap).length;
      const mergedTotal = Object.keys(merged.fileCoverageFor(file).statementMap).length;
      expect(mergedTotal, file).toBeGreaterThanOrEqual(nodeTotal);
    }
    // Location-matched overlap: node 3 + browser 4 on the same statement.
    expect(merged.fileCoverageFor(base.core).getLineCoverage()[1]).toBe(7);
  });
});

describe("informational browser merge output", () => {
  it("writes the merged report to a separate directory without overwriting the canonical node summary", () => {
    const base = webRepo();
    const { rootPath, relayPath } = writeNodeAndRelay(base);
    const browserPath = writeBrowser(base);
    const canonical = join(base.root, "coverage");
    mkdirSync(canonical, { recursive: true });
    writeFileSync(join(canonical, "coverage-summary.json"), '{"canonical":"node-only"}');
    const mergedDir = join(base.root, "coverage", "merged");

    const script = resolve(repoRoot, "scripts/coverage-merge.mjs");
    const result = spawnSync(
      process.execPath,
      [
        script,
        "--repo-root",
        base.root,
        "--root",
        rootPath,
        "--relay",
        relayPath,
        "--browser",
        browserPath,
        "--out",
        mergedDir,
      ],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(mergedDir, "coverage-summary.json"))).toBe(true);
    expect(readFileSync(join(canonical, "coverage-summary.json"), "utf8")).toBe(
      '{"canonical":"node-only"}',
    );
  });
});
