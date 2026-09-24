import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  baselineFromSummary,
  compareToBaseline,
  DEFAULT_TOLERANCE_POINTS,
  formatReport,
  isExcluded,
  METRICS,
  parseArgs,
  summarizeCoverage,
  surfaceForPath,
  validateBaseline,
} from "../../scripts/coverage-report.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const tempRoots: string[] = [];

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

type Counts = { covered: number; total: number; skipped: number; pct: number };

function counts(covered: number, total: number): Counts {
  return { covered, total, skipped: 0, pct: total === 0 ? 0 : (covered / total) * 100 };
}

function fileEntry(
  lines: [number, number],
  functions: [number, number] = lines,
  branches: [number, number] = lines,
  statements: [number, number] = lines,
) {
  return {
    lines: counts(...lines),
    functions: counts(...functions),
    branches: counts(...branches),
    statements: counts(...statements),
  };
}

function summaryFor(entries: Record<string, ReturnType<typeof fileEntry>>) {
  const keyed: Record<string, unknown> = {};
  for (const [path, entry] of Object.entries(entries)) {
    keyed[join("/repo", path)] = entry;
  }
  return keyed;
}

type BaselineDraft = ReturnType<typeof baselineFromSummary>;

function mutateBaseline(
  baseline: BaselineDraft,
  change: (draft: BaselineDraft) => void,
): BaselineDraft {
  const draft = structuredClone(baseline);
  change(draft);
  return draft;
}

describe("coverage surface grouping", () => {
  it("maps every configured source surface to its own surface and ignores unrelated paths", () => {
    const expected: Array<[string, string | null]> = [
      ["src/cli.ts", "core"],
      ["src/runtime/session-coordinator.ts", "core"],
      ["gui/server/server.ts", "gui-server"],
      ["gui/shared/event-reducer.ts", "gui-shared"],
      ["gui/web/src/App.jsx", "gui-web"],
      ["gui/web/src/components/button.jsx", "gui-web"],
      ["gui/hosted/src/main.jsx", "gui-hosted"],
      ["gui/hosted/runtime/browser-pi-session.ts", "gui-hosted"],
      ["packages/ui/src/button.jsx", "ui-package"],
      ["workers/provider-relay/src/relay.ts", "provider-relay"],
      ["website/src/page.ts", null],
      ["scripts/coverage-report.mjs", null],
    ];

    for (const [path, surface] of expected) {
      const record = surfaceForPath(path);
      expect(record?.id ?? null, path).toBe(surface);
    }
  });

  it("excludes generated declarations and build artifacts with a stated reason", () => {
    for (const path of [
      "src/pi/model-catalog.generated.ts",
      "workers/provider-relay/worker-configuration.d.ts",
      "src/types/vendor.d.ts",
      "src/dist/bundle.js",
      "src/node_modules/pkg/index.js",
      "src/foo.test.ts",
    ]) {
      const reason = isExcluded(path);
      expect(reason, path).toBeTruthy();
      expect(typeof reason).toBe("string");
    }

    expect(isExcluded("src/cli.ts")).toBeNull();
    expect(isExcluded("gui/web/src/App.jsx")).toBeNull();
  });
});

describe("summarizeCoverage", () => {
  const expectedFiles = ["src/a.ts", "src/b.ts", "src/c.ts", "gui/web/src/App.jsx"];

  it("groups files per surface and aggregates raw counts instead of averaging percentages", () => {
    const summary = summaryFor({
      "src/a.ts": fileEntry([1, 2]),
      "src/b.ts": fileEntry([3, 4]),
      "gui/web/src/App.jsx": fileEntry([5, 10]),
    });

    const current = summarizeCoverage({ summary, expectedFiles, repoRoot: "/repo" });
    const core = current.surfaces.find((surface) => surface.id === "core");
    const web = current.surfaces.find((surface) => surface.id === "gui-web");

    // (1/2 + 3/4) averaged as percentages is 62.5%; the honest aggregate is 4/6.
    expect(core?.totals.lines.covered).toBe(4);
    expect(core?.totals.lines.total).toBe(6);
    expect(Math.round((core.totals.lines.covered / core.totals.lines.total) * 10000) / 100).toBe(
      66.67,
    );
    expect(core?.expectedFileCount).toBe(3);
    expect(core?.missingFiles).toEqual(["src/c.ts"]);
    expect(core?.measured).toBe(true);
    expect(web?.measured).toBe(true);
  });

  it("reports global totals summed across every instrumented file", () => {
    const summary = summaryFor({
      "src/a.ts": fileEntry([1, 2]),
      "src/b.ts": fileEntry([3, 4]),
      "gui/web/src/App.jsx": fileEntry([5, 10]),
    });

    const current = summarizeCoverage({
      summary,
      expectedFiles: ["src/a.ts", "src/b.ts", "gui/web/src/App.jsx"],
      repoRoot: "/repo",
    });

    // 1+3+5 covered lines out of 2+4+10 total.
    expect(current.totals.lines).toMatchObject({ covered: 9, total: 16 });
    expect(current.totals.functions).toMatchObject({ covered: 9, total: 16 });
    expect(current.totals.branches).toMatchObject({ covered: 9, total: 16 });
    expect(current.totals.statements).toMatchObject({ covered: 9, total: 16 });
  });

  it("marks a surface with only unexecuted files as unmeasured and keeps its limitation", () => {
    const expected = ["packages/ui/src/button.jsx"];
    const summary = summaryFor({ "packages/ui/src/button.jsx": fileEntry([0, 8]) });

    const current = summarizeCoverage({ summary, expectedFiles: expected, repoRoot: "/repo" });
    const ui = current.surfaces.find((surface) => surface.id === "ui-package");

    expect(ui?.measured).toBe(false);
    expect(ui?.missingFiles).toEqual([]);
    expect(ui?.limitation).toMatch(/browser|component/i);
    expect(ui?.totals.lines.total).toBe(8);
  });

  it("reports a surface with no instrumented files as missing rather than as zero percent covered", () => {
    const expected = ["workers/provider-relay/src/relay.ts"];
    const current = summarizeCoverage({ summary: {}, expectedFiles: expected, repoRoot: "/repo" });
    const relay = current.surfaces.find((surface) => surface.id === "provider-relay");

    expect(relay?.missingFiles).toEqual(["workers/provider-relay/src/relay.ts"]);
    expect(relay?.measured).toBe(false);
    expect(current.missingSurfaces).toContain("provider-relay");
  });

  it("renders a compact per-surface report naming unmeasured surfaces and their limitation", () => {
    const summary = summaryFor({
      "src/a.ts": fileEntry([1, 2]),
      "gui/web/src/App.jsx": fileEntry([0, 5]),
    });
    const current = summarizeCoverage({
      summary,
      expectedFiles: ["src/a.ts", "gui/web/src/App.jsx"],
      repoRoot: "/repo",
    });

    const report = formatReport(current, compareToBaseline({ current, baseline: null }));

    expect(report).toContain("core");
    expect(report).toContain("gui-web");
    expect(report.toLowerCase()).toContain("unmeasured");
    expect(report).toContain("browser");
  });
});

describe("compareToBaseline", () => {
  function baselineForCurrent(current: ReturnType<typeof summarizeCoverage>) {
    return baselineFromSummary(current, {
      generatedAt: "2026-09-24T00:00:00.000Z",
      command: "test",
    });
  }

  function currentWith(coreLines: [number, number], extraExpected: string[] = []) {
    const expectedFiles = ["src/a.ts", ...extraExpected];
    const summary = summaryFor({ "src/a.ts": fileEntry(coreLines) });
    return summarizeCoverage({ summary, expectedFiles, repoRoot: "/repo" });
  }

  it("passes when a measured surface is unchanged", () => {
    const current = currentWith([8, 10]);
    const comparison = compareToBaseline({ current, baseline: baselineForCurrent(current) });

    expect(comparison.ok).toBe(true);
    expect(comparison.regressions).toEqual([]);
  });

  it("fails with a ratio regression when a measured surface drops beyond tolerance", () => {
    const baseline = baselineForCurrent(currentWith([8, 10]));
    const current = currentWith([7, 10]);
    const comparison = compareToBaseline({ current, baseline });

    expect(comparison.ok).toBe(false);
    expect(comparison.regressions[0]?.surface).toBe("core");
    expect(comparison.regressions[0]?.metric).toBe("lines");
    expect(comparison.regressions[0]?.dropPoints).toBeCloseTo(10, 5);
  });

  it("only absorbs float-level noise, not a real ratio drop", () => {
    const baseline = baselineForCurrent(currentWith([8, 10]));

    expect(DEFAULT_TOLERANCE_POINTS).toBeLessThan(0.01);
    const identical = compareToBaseline({ current: currentWith([8, 10]), baseline });
    expect(identical.ok).toBe(true);

    // 79.9% vs 80% is a real 0.1 point loss and must fail the initial baseline.
    const smallRealDrop = compareToBaseline({ current: currentWith([799, 1000]), baseline });
    expect(smallRealDrop.ok).toBe(false);

    const improved = compareToBaseline({ current: currentWith([9, 10]), baseline });
    expect(improved.ok).toBe(true);
    expect(improved.improvements.length).toBeGreaterThan(0);
  });

  it("surfaces a per-file branch loss even when another file gain hides it at surface level", () => {
    const expected = ["src/a.ts", "src/b.ts"];
    const baselineSummary = summaryFor({
      "src/a.ts": fileEntry([10, 10], [10, 10], [100, 100], [10, 10]),
      "src/b.ts": fileEntry([10, 10], [10, 10], [0, 100], [10, 10]),
    });
    const currentSummary = summaryFor({
      "src/a.ts": fileEntry([10, 10], [10, 10], [0, 100], [10, 10]),
      "src/b.ts": fileEntry([10, 10], [10, 10], [100, 100], [10, 10]),
    });
    const baseline = baselineForCurrent(
      summarizeCoverage({ summary: baselineSummary, expectedFiles: expected, repoRoot: "/repo" }),
    );
    const current = summarizeCoverage({
      summary: currentSummary,
      expectedFiles: expected,
      repoRoot: "/repo",
    });

    // Surface branch ratio is unchanged at 100/200, so only the per-file pass
    // can catch src/a.ts losing every branch.
    expect(current.surfaces.find((s) => s.id === "core")?.totals.branches).toEqual({
      covered: 100,
      total: 200,
      skipped: 0,
    });
    const comparison = compareToBaseline({ current, baseline });
    expect(comparison.ok).toBe(false);
    expect(comparison.regressions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ surface: "core", file: "src/a.ts", metric: "branches" }),
      ]),
    );
  });

  it("rejects a baseline with an unknown or omitted configured surface id", () => {
    const current = currentWith([8, 10]);
    const valid = baselineForCurrent(current);

    const unknown = mutateBaseline(valid, (draft) => {
      draft.surfaces["legacy-surface"] = { ...draft.surfaces.core };
    });
    const unknownComparison = compareToBaseline({ current, baseline: unknown });
    expect(unknownComparison.ok).toBe(false);
    expect(unknownComparison.baselineErrors.some((error) => /unknown surface/.test(error))).toBe(
      true,
    );

    const omitted = mutateBaseline(valid, (draft) => {
      delete draft.surfaces["provider-relay"];
    });
    const omittedComparison = compareToBaseline({ current, baseline: omitted });
    expect(omittedComparison.ok).toBe(false);
    expect(
      omittedComparison.baselineErrors.some((error) => /missing from baseline/.test(error)),
    ).toBe(true);
  });

  it("fails when a measured surface loses all execution", () => {
    const baseline = baselineForCurrent(currentWith([8, 10]));
    const current = summarizeCoverage({
      summary: summaryFor({ "src/a.ts": fileEntry([0, 10]) }),
      expectedFiles: ["src/a.ts"],
      repoRoot: "/repo",
    });
    const comparison = compareToBaseline({ current, baseline });

    expect(comparison.ok).toBe(false);
    expect(comparison.regressions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ surface: "core", reason: "surface became unmeasured" }),
      ]),
    );
  });

  it("fails when an expected file disappears from instrumented coverage", () => {
    const currentMissing = currentWith([8, 10], ["src/ghost.ts"]);
    const baseline = baselineForCurrent(currentMissing);
    const comparison = compareToBaseline({ current: currentMissing, baseline });

    expect(comparison.ok).toBe(false);
    expect(comparison.missing).toEqual(
      expect.arrayContaining([expect.objectContaining({ surface: "core", file: "src/ghost.ts" })]),
    );
  });

  it("rejects empty, mis-ordered, malformed, and inconsistent baselines", () => {
    const current = currentWith([8, 10]);
    const valid = baselineForCurrent(current);
    const malformed: unknown[] = [
      {},
      { schemaVersion: 1, surfaces: {} },
      { schemaVersion: 1, metricOrder: ["lines"], surfaces: { core: {} } },
      mutateBaseline(valid, (draft) => {
        draft.metricOrder = [...METRICS].reverse();
      }),
      mutateBaseline(valid, (draft) => {
        draft.surfaces.core.totals.lines = [-1, 10];
      }),
      mutateBaseline(valid, (draft) => {
        draft.surfaces.core.totals.lines = [11, 10];
      }),
      mutateBaseline(valid, (draft) => {
        draft.surfaces.core.totals.lines = [1.5, 10];
      }),
      mutateBaseline(valid, (draft) => {
        draft.surfaces.core.expectedFileCount = 999;
      }),
      mutateBaseline(valid, (draft) => {
        draft.surfaces.core.files["src/a.ts"] = [1, 1, 1, 1, 1, 1];
      }),
    ];

    for (const baseline of malformed) {
      const comparison = compareToBaseline({ current, baseline });
      expect(comparison.ok, JSON.stringify(baseline)).toBe(false);
      expect(comparison.baselineErrors.length).toBeGreaterThan(0);
    }
  });

  it("rejects an invalid tolerance when called programmatically", () => {
    const current = currentWith([8, 10]);
    const baseline = baselineForCurrent(current);
    for (const tolerancePoints of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(() => compareToBaseline({ current, baseline, tolerancePoints })).toThrow(/tolerance/);
    }
  });

  it("accepts a schema-valid baseline and reports no validation errors", () => {
    const current = currentWith([8, 10]);
    const baseline = baselineForCurrent(current);

    expect(validateBaseline(baseline)).toEqual([]);
    expect(compareToBaseline({ current, baseline }).baselineErrors).toEqual([]);
  });
});

describe("coverage report baseline handling", () => {
  it("only enables baseline writes when explicitly requested", () => {
    expect(parseArgs([]).updateBaseline).toBe(false);
    expect(parseArgs(["--check"]).updateBaseline).toBe(false);
    expect(parseArgs(["--update-baseline"]).updateBaseline).toBe(true);
    expect(parseArgs(["--tolerance", "1.5"]).tolerancePoints).toBe(1.5);
    expect(parseArgs(["--coverage", "out/cov.json"]).coveragePath).toBe("out/cov.json");
  });

  it("rejects a non-finite or negative tolerance instead of disabling the check", () => {
    for (const value of ["NaN", "-1", "Infinity", "-Infinity"]) {
      expect(() => parseArgs(["--tolerance", value]), value).toThrow(/tolerance/);
    }
  });

  it("writes and checks a baseline through the real command line", () => {
    const root = makeTempRoot("opencandle-coverage-");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(join(root, "src", "b.ts"), "export const b = 2;\n");

    const coveragePath = join(root, "cov.json");
    const baselinePath = join(root, "baseline.json");
    const scriptPath = resolve(repoRoot, "scripts/coverage-report.mjs");

    const writeSummary = (includeB: boolean) => {
      const entries: Record<string, unknown> = {
        [join(root, "src", "a.ts")]: fileEntry([1, 1]),
      };
      if (includeB) entries[join(root, "src", "b.ts")] = fileEntry([1, 1]);
      writeFileSync(coveragePath, JSON.stringify(entries));
    };

    const run = (args: string[]) =>
      spawnSync(
        process.execPath,
        [
          scriptPath,
          "--repo-root",
          root,
          "--coverage",
          coveragePath,
          "--baseline",
          baselinePath,
          ...args,
        ],
        { encoding: "utf8" },
      );

    writeSummary(true);
    const created = run(["--update-baseline"]);
    expect(created.status, created.stderr).toBe(0);
    expect(existsSync(baselinePath)).toBe(true);

    const clean = run(["--check"]);
    expect(clean.status, clean.stderr).toBe(0);

    writeSummary(false);
    const regressed = run(["--check"]);
    expect(regressed.status).toBe(1);
    expect(`${regressed.stdout}${regressed.stderr}`).toMatch(/missing|regression/i);

    // A truncated baseline must be rejected, not treated as "no change".
    writeFileSync(baselinePath, "{}\n");
    const rejected = run(["--check"]);
    expect(rejected.status).toBe(2);
    expect(`${rejected.stdout}${rejected.stderr}`).toMatch(/rejected|schemaVersion|surfaces/i);
  });

  it("never evaluates an informational merged report against the node baseline", () => {
    const root = makeTempRoot("opencandle-coverage-info-");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
    const summaryPath = join(root, "merged-summary.json");
    const baselinePath = join(root, "baseline.json");
    const outputPath = join(root, "merged-report.txt");
    const metadataPath = join(root, "metadata.json");
    const scriptPath = resolve(repoRoot, "scripts/coverage-report.mjs");

    const run = (args: string[]) =>
      spawnSync(
        process.execPath,
        [
          scriptPath,
          "--repo-root",
          root,
          "--input",
          summaryPath,
          "--baseline",
          baselinePath,
          ...args,
        ],
        { encoding: "utf8" },
      );

    // Node baseline: a.ts at 80%.
    writeFileSync(summaryPath, JSON.stringify({ [join(root, "src", "a.ts")]: fileEntry([8, 10]) }));
    expect(run(["--update-baseline"]).status).toBe(0);

    // A merged report whose ratio dropped would fail a node-baseline check.
    writeFileSync(summaryPath, JSON.stringify({ [join(root, "src", "a.ts")]: fileEntry([2, 10]) }));
    expect(run(["--check"]).status).toBe(1);

    writeFileSync(
      metadataPath,
      JSON.stringify({
        runtime: { node: "22.23.0", v8: "12.4.254.21-node.56" },
        build: { assets: ["index-abc.js"] },
        browser: { versions: ["153.0.8010.53"] },
      }),
    );

    const informational = run([
      "--informational",
      "--output",
      outputPath,
      "--metadata",
      metadataPath,
    ]);
    expect(informational.status, informational.stderr).toBe(0);
    expect(informational.stdout).toMatch(/informational/i);
    expect(informational.stdout).not.toMatch(/regressions against baseline/i);
    const written = readFileSync(outputPath, "utf8");
    expect(written).toMatch(/informational/i);
    expect(written).toMatch(/22\.23\.0/);
    expect(written).toMatch(/153\.0\.8010\.53/);
  });
});
