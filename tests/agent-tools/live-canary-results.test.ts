import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CanaryCaseResult,
  CanaryResults,
  createRunId,
  redactReason,
  resolveStrictMode,
  resolveSummaryPath,
  runCases,
  skip,
  verifyHistoryPayload,
  verifyQuotePayload,
  writeSummaryFile,
} from "../e2e/live-canary-results.js";
import { buildReleaseSmokeCases, resolveCandidateCommit } from "../e2e/provider-release-smoke.js";

function caseResult(
  name: string,
  outcome: CanaryCaseResult["outcome"],
  optional: boolean,
): CanaryCaseResult {
  return { name, outcome, optional, durationMs: 0 };
}

const validQuote = {
  price: 190.5,
  currency: "USD",
  freshness: {
    cacheStatus: "live",
    providerDataAt: "2026-09-24T15:30:00.000Z",
    isStaleForSession: false,
    marketSession: "open",
  },
};

const validHistory = [
  {
    date: "2026-09-22",
    timestamp: 1_790_035_200,
    open: 188.1,
    high: 190.2,
    low: 187.4,
    close: 189.9,
    volume: 41_000_000,
  },
  {
    date: "2026-09-23",
    timestamp: 1_790_121_600,
    open: 189.9,
    high: 192.1,
    low: 189.2,
    close: 191.4,
    volume: 38_000_000,
  },
];

describe("live canary results reporter", () => {
  it("records explicit pass, fail, and skip outcomes", async () => {
    const results = await runCases([
      { name: "core-pass", run: async () => {} },
      {
        name: "optional-fail",
        optional: true,
        run: async () => {
          throw new Error("boom");
        },
      },
      {
        name: "optional-skip",
        optional: true,
        run: async () => {
          skip("ALPHA_VANTAGE_API_KEY not configured");
        },
      },
    ]);

    expect(results.counts()).toEqual({
      total: 3,
      passed: 1,
      failed: 1,
      skipped: 1,
      corePassed: 1,
      coreSkipped: 0,
      optionalSkipped: 1,
    });
    expect(results.all().find((result) => result.name === "optional-skip")?.reason).toBe(
      "ALPHA_VANTAGE_API_KEY not configured",
    );
  });

  it("requires a nonzero core pass and blocks core skips by default", () => {
    const withOptionalSkip = new CanaryResults();
    withOptionalSkip.add(caseResult("core-pass", "passed", false));
    withOptionalSkip.add(caseResult("optional-skip", "skipped", true));
    expect(withOptionalSkip.exitCode()).toBe(0);
    expect(withOptionalSkip.exitCode({ requireAll: true })).toBe(1);

    const withCoreSkip = new CanaryResults();
    withCoreSkip.add(caseResult("core-pass", "passed", false));
    withCoreSkip.add(caseResult("core-skip", "skipped", false));
    expect(withCoreSkip.exitCode()).toBe(1);

    const withFailure = new CanaryResults();
    withFailure.add(caseResult("core-pass", "passed", false));
    withFailure.add(caseResult("optional-fail", "failed", true));
    expect(withFailure.exitCode()).toBe(1);

    const noCorePass = new CanaryResults();
    noCorePass.add(caseResult("optional-pass", "passed", true));
    expect(noCorePass.exitCode()).toBe(1);
  });

  it("does not claim all-passed when anything was skipped", () => {
    const allPassed = new CanaryResults();
    allPassed.add(caseResult("core", "passed", false));
    expect(allPassed.formatSummary()).toContain("All tests passed!");

    const withSkip = new CanaryResults();
    withSkip.add(caseResult("core", "passed", false));
    withSkip.add(caseResult("optional", "skipped", true));
    const summary = withSkip.formatSummary();
    expect(summary).toContain("1 passed, 0 failed, 1 skipped");
    expect(summary).toContain("Skipped:");
    expect(summary).not.toContain("All tests passed!");
  });

  it("parses strict mode from argv and environment", () => {
    expect(resolveStrictMode([], {})).toBe(false);
    expect(resolveStrictMode(["--require-all"], {})).toBe(true);
    expect(resolveStrictMode([], { OPENCANDLE_CANARY_REQUIRE_ALL: "1" })).toBe(true);
  });

  it("assembles unique run summary paths", () => {
    expect(resolveSummaryPath("/repo", "run-1")).toBe(
      join("/repo", "validation-output", "provider-release", "run-1", "summary.json"),
    );
    expect(createRunId(new Date("2026-09-24T12:00:00.000Z"))).not.toBe(
      createRunId(new Date("2026-09-24T12:00:01.000Z")),
    );
  });

  it("writes summary JSON with parent directories and redacts credentials", () => {
    const dir = mkdtempSync(join(tmpdir(), "canary-results-test-"));
    try {
      const path = resolveSummaryPath(dir, "run-1");
      writeSummaryFile(path, { status: "passed" });
      expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ status: "passed" });

      const redacted = redactReason(
        "https://www.alphavantage.co/query?function=X&apikey=SECRET123&y=2",
      );
      expect(redacted).toContain("apikey=[redacted]");
      expect(redacted).not.toContain("SECRET123");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("provider release smoke verifiers", () => {
  it("accepts a live quote payload and rejects invalid ones", () => {
    expect(verifyQuotePayload(validQuote).status).toBe("passed");

    const invalidPayloads: unknown[] = [
      null,
      {},
      { ...validQuote, price: 0 },
      { ...validQuote, price: Number.NaN },
      { ...validQuote, price: -1 },
      { ...validQuote, currency: "  " },
      { ...validQuote, currency: null },
      { price: 190.5, currency: "USD" },
      {
        ...validQuote,
        freshness: { cacheStatus: "stale", providerDataAt: "2026-09-24T15:30:00Z" },
      },
      {
        ...validQuote,
        freshness: {
          cacheStatus: "live",
          providerDataAt: "2026-09-24T15:30:00Z",
          isStaleForSession: true,
        },
      },
      { ...validQuote, freshness: { cacheStatus: "live", isStaleForSession: false } },
    ];
    for (const payload of invalidPayloads) {
      const verdict = verifyQuotePayload(payload);
      expect(verdict.status, JSON.stringify(payload)).toBe("failed");
      expect(verdict.reason).toBeTruthy();
    }
  });

  it("accepts ordered finite history across date-only, timestamp, and mixed domains", () => {
    expect(verifyHistoryPayload(validHistory).status).toBe("passed");

    const day1 = Date.parse("2026-09-22T00:00:00.000Z");
    const day2 = day1 + 86_400_000;
    const bar = (overrides: Record<string, unknown>) => ({
      date: "2026-09-22",
      timestamp: day1,
      open: 100,
      high: 105,
      low: 95,
      close: 102,
      volume: 1000,
      ...overrides,
    });
    const dateOnly = (date: string, overrides: Record<string, unknown> = {}) => {
      const { timestamp: _timestamp, ...rest } = bar({ ...overrides, date });
      return rest;
    };

    // Date-only bars (no timestamp) and mixed representations normalize into
    // one finite epoch domain and must still be strictly increasing.
    expect(verifyHistoryPayload([dateOnly("2026-09-22"), dateOnly("2026-09-23")]).status).toBe(
      "passed",
    );
    expect(
      verifyHistoryPayload([dateOnly("2026-09-22"), bar({ date: "2026-09-23", timestamp: day2 })])
        .status,
    ).toBe("passed");
  });

  it("rejects empty, stale, malformed-date, duplicate-day, unordered, and bad-OHLC history", () => {
    const day1 = Date.parse("2026-09-22T00:00:00.000Z");
    const day2 = day1 + 86_400_000;
    const bar = (overrides: Record<string, unknown>) => ({
      date: "2026-09-22",
      timestamp: day1,
      open: 100,
      high: 105,
      low: 95,
      close: 102,
      volume: 1000,
      ...overrides,
    });

    const invalidPayloads: unknown[] = [
      [],
      null,
      { bars: validHistory, stale: true },
      // malformed / missing date and timestamp
      [{ ...bar({ timestamp: undefined }), date: "not-a-date" }],
      [{ ...bar({ timestamp: undefined }), date: "" }],
      [{ ...bar({ timestamp: Number.NaN }) }],
      [{ ...bar({ timestamp: Number.POSITIVE_INFINITY }) }],
      [{ ...bar({ timestamp: undefined, date: undefined }) }],
      // date and timestamp disagree
      [bar({ date: "2020-01-01" })],
      // duplicate day, including two intraday timestamps on the same UTC day
      [bar({ timestamp: undefined }), bar({ timestamp: undefined })],
      [bar({ timestamp: day1 }), bar({ timestamp: day1 + 3_600_000 })],
      // unordered timestamps
      [bar({ date: "2026-09-23", timestamp: day2 }), bar({ date: "2026-09-22", timestamp: day1 })],
      // non-positive or non-finite prices
      [bar({ close: Number.NaN })],
      [bar({ high: Number.POSITIVE_INFINITY })],
      [bar({ open: 0 })],
      [bar({ low: -1 })],
      // volume
      [bar({ volume: -1 })],
      [bar({ volume: Number.NaN })],
      // OHLC structural bounds
      [bar({ high: 101, close: 102 })],
      [bar({ low: 101, open: 100 })],
      [bar({ high: 99, low: 95, open: 100, close: 102 })],
      [bar({ low: 106, high: 105, open: 100, close: 102 })],
    ];
    for (const payload of invalidPayloads) {
      const verdict = verifyHistoryPayload(payload);
      expect(verdict.status, JSON.stringify(payload)).toBe("failed");
      expect(verdict.reason, JSON.stringify(payload)).toBeTruthy();
    }
  });
});

describe("provider release smoke commit evidence", () => {
  it("resolves the candidate commit in a git worktree and null outside one", () => {
    expect(resolveCandidateCommit(process.cwd())).toMatch(/^[0-9a-f]{40}$/);

    const dir = mkdtempSync(join(tmpdir(), "canary-no-git-"));
    try {
      expect(resolveCandidateCommit(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("provider release smoke runner integration", () => {
  it("builds exactly the two core checks and runs them from injected tool payloads", async () => {
    const quoteCalls: Array<Record<string, unknown>> = [];
    const quoteTool = {
      execute: async (_id: string, args: Record<string, unknown>) => {
        quoteCalls.push(args);
        return { content: [], details: validQuote };
      },
    };
    const historyTool = {
      execute: async () => ({ content: [], details: validHistory }),
    };

    const cases = buildReleaseSmokeCases(quoteTool, historyTool);
    expect(cases).toHaveLength(2);
    expect(cases.map((item) => item.name)).toEqual([
      "get_stock_quote:AAPL",
      "get_stock_history:AAPL",
    ]);
    expect(cases.every((item) => item.optional === false)).toBe(true);

    const results = await runCases(cases);
    expect(results.counts()).toMatchObject({
      total: 2,
      passed: 2,
      failed: 0,
      skipped: 0,
      corePassed: 2,
    });
    expect(results.exitCode({ requireAll: true })).toBe(0);
    expect(quoteCalls).toEqual([{ symbol: "AAPL" }]);
  });

  it("fails (does not skip) when an injected tool returns an unusable payload", async () => {
    const cases = buildReleaseSmokeCases(
      { execute: async () => ({ content: [], details: null }) },
      { execute: async () => ({ content: [], details: [] }) },
    );

    const results = await runCases(cases);
    expect(results.counts()).toMatchObject({
      total: 2,
      passed: 0,
      failed: 2,
      skipped: 0,
      coreSkipped: 0,
    });
    expect(results.exitCode({ requireAll: true })).toBe(1);
  });
});
