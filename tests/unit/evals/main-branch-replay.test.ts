import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProductReplayComparison,
  findLatestProductEvalReport,
  summarizeProductReplayReport,
  unsupportedProductReplayRun,
  writeProductReplayComparisonReport,
} from "../../evals/main-branch-replay.js";
import type { ProductEvalReport } from "../../evals/product/types.js";

function productReport(overrides: Partial<ProductEvalReport> = {}): ProductEvalReport {
  return {
    generatedAt: "2026-05-25T00:00:00.000Z",
    caseCount: 2,
    aggregate: 0.75,
    passed: 1,
    failed: 1,
    byFamily: {},
    byDimension: {},
    results: [
      {
        id: "education-options",
        family: "education",
        prompt: "Explain covered calls.",
        score: 0.5,
        passed: false,
        mandatoryFailure: true,
        dimensions: [],
      },
      {
        id: "portfolio-rebalance",
        family: "portfolio",
        prompt: "How should I rebalance this portfolio?",
        score: 1,
        passed: true,
        mandatoryFailure: false,
        dimensions: [],
      },
    ],
    ...overrides,
  };
}

describe("main branch product replay comparison", () => {
  it("summarizes score and pass deltas between two product eval reports", () => {
    const base = summarizeProductReplayReport({
      ref: "origin/main",
      reportPath: "/tmp/main/tests/evals/runs/main_product-evals.json",
      report: productReport({ aggregate: 0.75, passed: 1, failed: 1 }),
    });
    const current = summarizeProductReplayReport({
      ref: "feature",
      reportPath: "/repo/tests/evals/runs/current_product-evals.json",
      report: productReport({
        aggregate: 1,
        passed: 2,
        failed: 0,
        results: [
          {
            id: "education-options",
            family: "education",
            prompt: "Explain covered calls.",
            score: 1,
            passed: true,
            mandatoryFailure: false,
            dimensions: [],
          },
          {
            id: "portfolio-rebalance",
            family: "portfolio",
            prompt: "How should I rebalance this portfolio?",
            score: 1,
            passed: true,
            mandatoryFailure: false,
            dimensions: [],
          },
        ],
      }),
    });

    const comparison = buildProductReplayComparison({ current, base });

    expect(comparison.status).toBe("compared");
    expect(comparison.aggregateDelta).toBeCloseTo(0.25);
    expect(comparison.passDelta).toBe(1);
    expect(comparison.caseChanges).toEqual([
      expect.objectContaining({
        id: "education-options",
        status: "improved",
        baseScore: 0.5,
        currentScore: 1,
        scoreDelta: 0.5,
        basePassed: false,
        currentPassed: true,
      }),
      expect.objectContaining({
        id: "portfolio-rebalance",
        status: "unchanged",
        scoreDelta: 0,
      }),
    ]);
  });

  it("reports unsupported base refs without scoring them as wins or losses", () => {
    const current = summarizeProductReplayReport({
      ref: "feature",
      reportPath: "/repo/tests/evals/runs/current_product-evals.json",
      report: productReport({ aggregate: 0.9, passed: 2, failed: 0 }),
    });
    const base = unsupportedProductReplayRun(
      "origin/main",
      "package.json does not define the eval front door",
    );

    const comparison = buildProductReplayComparison({ current, base });

    expect(comparison.status).toBe("unsupported");
    expect(comparison.aggregateDelta).toBeUndefined();
    expect(comparison.passDelta).toBeUndefined();
    expect(comparison.caseChanges).toEqual([]);
    expect(comparison.unsupportedReason).toBe("package.json does not define the eval front door");
  });

  it("keeps product replay compatible with pre-front-door base branches", () => {
    const source = readFileSync("tests/scripts/run-main-branch-product-replay.ts", "utf-8");

    expect(source).toContain('scripts?.["test:evals:product"]');
    expect(source).toContain('"npm", "run", "test:evals:product"');
  });

  it("writes comparison reports under tests/evals/runs and discovers latest product reports", () => {
    const cwd = mkdtempSync(join(tmpdir(), "oc-product-replay-"));
    const comparison = buildProductReplayComparison({
      current: summarizeProductReplayReport({
        ref: "feature",
        reportPath: "/repo/current.json",
        report: productReport({ aggregate: 1, passed: 2, failed: 0 }),
      }),
      base: summarizeProductReplayReport({
        ref: "origin/main",
        reportPath: "/tmp/base.json",
        report: productReport({ aggregate: 0.75, passed: 1, failed: 1 }),
      }),
      generatedAt: "2026-05-25T10:00:00.000Z",
    });

    const outputPath = writeProductReplayComparisonReport(comparison, cwd);
    writeFileSync(
      join(cwd, "tests", "evals", "runs", "2026-05-25T09-00-00-000Z_product-evals.json"),
      "{}\n",
      "utf-8",
    );
    writeFileSync(
      join(cwd, "tests", "evals", "runs", "2026-05-25T11-00-00-000Z_product-evals.json"),
      "{}\n",
      "utf-8",
    );

    expect(outputPath).toMatch(
      /tests\/evals\/runs\/2026-05-25T10-00-00-000Z_product-replay-comparison\.json$/,
    );
    expect(JSON.parse(readFileSync(outputPath, "utf-8")).status).toBe("compared");
    expect(findLatestProductEvalReport(cwd)).toMatch(
      /2026-05-25T11-00-00-000Z_product-evals\.json$/,
    );
  });
});
