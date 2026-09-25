import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertCompletionReportShape,
  buildCompletionReport,
  COMPLETION_REPORT_PATH_ENV,
  type CompletionReport,
  convertVitestJsonReport,
  validateCompletionReport,
  writeCompletionReport,
} from "../../evals/completion-report.js";

const startedAt = "2026-07-05T00:00:00.000Z";
const finishedAt = "2026-07-05T00:00:10.000Z";

function report(overrides: Partial<CompletionReport> = {}): CompletionReport {
  return {
    version: 1,
    suite: "cases",
    startedAt,
    finishedAt,
    cases: [{ id: "router.eval.ts", status: "passed" }],
    exitCode: 0,
    settings: { provider: "google", model: "gemini-2.5-flash" },
    ...overrides,
  };
}

describe("completion report shape", () => {
  it("accepts a well-formed report and derives exit codes", () => {
    expect(() => assertCompletionReportShape(report())).not.toThrow();
    expect(
      buildCompletionReport({
        suite: "cases",
        startedAt,
        finishedAt,
        cases: [{ id: "a", status: "passed" }],
      }).exitCode,
    ).toBe(0);
    expect(
      buildCompletionReport({
        suite: "cases",
        startedAt,
        finishedAt,
        cases: [
          { id: "a", status: "passed" },
          { id: "b", status: "failed", reason: "assertion failed" },
        ],
      }).exitCode,
    ).toBe(1);
  });

  it("rejects an empty case list", () => {
    expect(() => assertCompletionReportShape(report({ cases: [] }))).toThrow(/at least one case/i);
  });

  it("rejects duplicate case ids", () => {
    expect(() =>
      assertCompletionReportShape(
        report({
          cases: [
            { id: "a", status: "passed" },
            { id: "a", status: "failed" },
          ],
          exitCode: 1,
        }),
      ),
    ).toThrow(/duplicate case id/i);
  });

  it("rejects malformed dates", () => {
    expect(() => assertCompletionReportShape(report({ startedAt: "yesterday" }))).toThrow(
      /startedAt/i,
    );
    expect(() => assertCompletionReportShape(report({ finishedAt: "2026-99-99" }))).toThrow(
      /finishedAt/i,
    );
    expect(() =>
      assertCompletionReportShape(report({ finishedAt: "2026-07-04T00:00:00.000Z" })),
    ).toThrow(/before startedAt/i);
  });

  it("rejects unknown statuses and malformed case ids", () => {
    expect(() =>
      assertCompletionReportShape(
        report({ cases: [{ id: "a", status: "errored" as unknown as "passed" }] }),
      ),
    ).toThrow(/status/i);
    expect(() =>
      assertCompletionReportShape(report({ cases: [{ id: "", status: "passed" }] })),
    ).toThrow(/case id/i);
  });

  it("rejects an inconsistent exit code", () => {
    expect(() =>
      assertCompletionReportShape(report({ cases: [{ id: "a", status: "failed" }], exitCode: 0 })),
    ).toThrow(/exitCode/i);
    expect(() => assertCompletionReportShape(report({ exitCode: 1.5 }))).toThrow(/exitCode/i);
  });

  it("rejects settings keys outside the fixed allowlist and non-string values", () => {
    expect(() =>
      assertCompletionReportShape(report({ settings: { api_key: "sk-live-secret" } })),
    ).toThrow(/settings/i);
    expect(() =>
      assertCompletionReportShape(
        report({ settings: { prompt: "write me a full investment thesis" } }),
      ),
    ).toThrow(/settings/i);
    expect(() =>
      assertCompletionReportShape(report({ settings: { provider: 5 as unknown as string } })),
    ).toThrow(/settings/i);
  });

  it("accepts the settings keys the eval runners emit", () => {
    expect(() =>
      assertCompletionReportShape(
        report({
          settings: {
            provider: "google",
            model: "gemini-2.5-flash",
            mode: "frozen",
            seed: "2026-07-05",
          },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertCompletionReportShape(report({ settings: { tier: "usually" } })),
    ).not.toThrow();
    // The allowlist governs keys, not value contents; there is no generic
    // secret scanning of allowlisted model metadata.
    expect(() =>
      assertCompletionReportShape(report({ settings: { model: "sk-not-a-real-key" } })),
    ).not.toThrow();
  });

  it("rejects skipped and failed cases during strict validation", () => {
    expect(() => validateCompletionReport(report())).not.toThrow();
    expect(() =>
      validateCompletionReport(
        report({ cases: [{ id: "a", status: "skipped", reason: "opt-in" }] }),
      ),
    ).toThrow(/skipped/i);
    expect(() =>
      validateCompletionReport(report({ cases: [{ id: "a", status: "failed" }], exitCode: 1 })),
    ).toThrow(/failed/i);
  });

  it("rejects an all-passed report with a nonzero exit code", () => {
    expect(() => validateCompletionReport(report({ exitCode: 1 }))).toThrow(/exitCode/i);
  });
});

describe("completion report writer", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "oc-completion-report-"));
    dirs.push(dir);
    return dir;
  }

  it("does nothing when the completion path env var is unset or blank", () => {
    const dir = tempDir();
    expect(writeCompletionReport(report(), {})).toBeNull();
    expect(writeCompletionReport(report(), { [COMPLETION_REPORT_PATH_ENV]: "  " })).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("atomically writes only the known schema fields when the env var is set", () => {
    const dir = tempDir();
    const path = join(dir, "nested", "completion.json");
    const withSecretExtra = {
      ...report(),
      trace: "raw tool trace that must never persist",
    } as CompletionReport & { trace: string };
    const written = writeCompletionReport(withSecretExtra, {
      [COMPLETION_REPORT_PATH_ENV]: path,
    });

    expect(written).toBe(path);
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    expect(parsed).toEqual({
      version: 1,
      suite: "cases",
      startedAt,
      finishedAt,
      cases: [{ id: "router.eval.ts", status: "passed" }],
      exitCode: 0,
      settings: { provider: "google", model: "gemini-2.5-flash" },
    });
    expect(parsed.trace).toBeUndefined();
    expect(readdirSync(join(dir, "nested"))).toEqual(["completion.json"]);
  });

  it("still serializes a failed report for evidence", () => {
    const dir = tempDir();
    const path = join(dir, "failed.json");
    const failed = buildCompletionReport({
      suite: "cases",
      startedAt,
      finishedAt,
      cases: [{ id: "router.eval.ts", status: "failed", reason: "router mismatch" }],
    });
    const written = writeCompletionReport(failed, { [COMPLETION_REPORT_PATH_ENV]: path });

    expect(written).toBe(path);
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as CompletionReport;
    expect(parsed.exitCode).toBe(1);
    expect(parsed.cases).toEqual([
      { id: "router.eval.ts", status: "failed", reason: "router mismatch" },
    ]);
    expect(() => assertCompletionReportShape(parsed)).not.toThrow();
    expect(() => validateCompletionReport(parsed)).toThrow(/failed/i);
  });

  it("refuses to write a malformed report", () => {
    const dir = tempDir();
    const path = join(dir, "completion.json");
    expect(() =>
      writeCompletionReport(report({ cases: [] }), { [COMPLETION_REPORT_PATH_ENV]: path }),
    ).toThrow(/at least one case/i);
    expect(existsSync(path)).toBe(false);
  });
});

interface VitestPayloadFixture {
  numTotalTestSuites?: number;
  numPassedTestSuites?: number;
  numFailedTestSuites?: number;
  numPendingTestSuites?: number;
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  startTime?: number;
  success?: boolean;
  testResults?: Array<{
    assertionResults?: Array<{
      ancestorTitles?: string[];
      fullName?: string;
      status?: string;
      title?: string;
      duration?: number;
      failureMessages?: string[];
    }>;
    startTime?: number;
    endTime?: number;
    status?: string;
    message?: string;
    name?: string;
  }>;
}

// Mirrors the Vitest JSON reporter (`vitest --reporter=json`) payload shape:
// top-level counters plus one testResults entry per file, each with
// assertionResults using the reporter's "passed" | "failed" | "pending" |
// "skipped" | "todo" statuses.
function vitestPayload(overrides: Partial<VitestPayloadFixture> = {}): VitestPayloadFixture {
  return {
    numTotalTestSuites: 1,
    numPassedTestSuites: 1,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: 2,
    numPassedTests: 2,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    startTime: 1758700000000,
    success: true,
    testResults: [
      {
        assertionResults: [
          {
            ancestorTitles: ["router"],
            fullName: "router routes equities",
            status: "passed",
            title: "routes equities",
            duration: 12,
            failureMessages: [],
          },
          {
            ancestorTitles: ["router"],
            fullName: "router routes crypto",
            status: "passed",
            title: "routes crypto",
            duration: 8,
            failureMessages: [],
          },
        ],
        startTime: 1758700000000,
        endTime: 1758700000100,
        status: "passed",
        message: "",
        name: "/repo/tests/evals/cases/router.eval.ts",
      },
    ],
    ...overrides,
  };
}

// The intentional placeholder emitted by debate.eval.ts (and its siblings) when
// EVAL_TIER is not "usually".
const DEBATE_SKIP_ID = "Debate Evals (Usually-tier) skipped — run with EVAL_TIER=usually";

function placeholderPayload(options: { includePassed?: boolean } = {}): VitestPayloadFixture {
  const includePassed = options.includePassed ?? true;
  const assertions = [
    ...(includePassed
      ? [
          {
            ancestorTitles: ["quality"],
            fullName: "quality scores an answer",
            status: "passed",
            failureMessages: [],
          },
        ]
      : []),
    {
      ancestorTitles: ["Debate Evals (Usually-tier)"],
      fullName: DEBATE_SKIP_ID,
      status: "skipped",
      failureMessages: [],
    },
  ];
  return vitestPayload({
    numTotalTestSuites: 1,
    numPassedTestSuites: includePassed ? 1 : 0,
    numFailedTestSuites: 0,
    numTotalTests: assertions.length,
    numPassedTests: includePassed ? 1 : 0,
    numFailedTests: 0,
    numPendingTests: 1,
    success: true,
    testResults: [
      {
        assertionResults: assertions,
        startTime: 1758700000000,
        endTime: 1758700000100,
        status: "passed",
        message: "",
        name: "/repo/tests/evals/cases/mixed.eval.ts",
      },
    ],
  });
}

describe("Vitest JSON report conversion", () => {
  it("converts a real passing payload to the completion report shape", () => {
    const converted = convertVitestJsonReport(vitestPayload(), { suite: "cases" });

    expect(converted.version).toBe(1);
    expect(converted.suite).toBe("cases");
    expect(converted.exitCode).toBe(0);
    expect(converted.startedAt).toBe("2025-09-24T07:46:40.000Z");
    expect(converted.finishedAt).toBe("2025-09-24T07:46:40.100Z");
    expect(converted.cases).toEqual([
      { id: "router routes equities", status: "passed" },
      { id: "router routes crypto", status: "passed" },
    ]);
    expect(() => validateCompletionReport(converted)).not.toThrow();
  });

  it("marks skipped and todo cases skipped and fails strict validation", () => {
    const converted = convertVitestJsonReport(
      vitestPayload({
        numPassedTests: 1,
        numPendingTests: 1,
        numTodoTests: 1,
        numTotalTests: 3,
        testResults: [
          {
            assertionResults: [
              { fullName: "a", status: "passed", failureMessages: [] },
              { fullName: "b", status: "pending", failureMessages: [] },
              { fullName: "c", status: "todo", failureMessages: [] },
            ],
            startTime: 1758700000000,
            endTime: 1758700000100,
            status: "passed",
            message: "",
            name: "/repo/tests/evals/cases/x.eval.ts",
          },
        ],
      }),
      { suite: "cases" },
    );

    expect(converted.cases).toEqual([
      { id: "a", status: "passed" },
      { id: "b", status: "skipped", reason: "vitest status: pending" },
      { id: "c", status: "skipped", reason: "vitest status: todo" },
    ]);
    expect(converted.exitCode).toBe(1);
    expect(() => validateCompletionReport(converted)).toThrow(/skipped/i);
  });

  it("keeps an intentionally skipped placeholder visible but rejects it by default", () => {
    const converted = convertVitestJsonReport(placeholderPayload(), { suite: "cases" });

    expect(converted.cases).toContainEqual({
      id: DEBATE_SKIP_ID,
      status: "skipped",
      reason: "vitest status: skipped",
    });
    expect(converted.exitCode).toBe(1);
    expect(() => validateCompletionReport(converted)).toThrow(/skipped/i);
  });

  it("never infers optionality from skip status or the case name", () => {
    const converted = convertVitestJsonReport(placeholderPayload(), { suite: "cases" });

    expect(() =>
      validateCompletionReport(converted, { optionalCaseIds: ["some-unrelated-case"] }),
    ).toThrow(/skipped/i);
    expect(() =>
      validateCompletionReport(converted, {
        isOptionalCase: (testCase) => testCase.id === "no match",
      }),
    ).toThrow(/skipped/i);
  });

  it("excuses a skipped placeholder only under an explicit caller policy", () => {
    const converted = convertVitestJsonReport(placeholderPayload(), {
      suite: "cases",
      optionalCaseIds: [DEBATE_SKIP_ID],
    });

    expect(converted.exitCode).toBe(0);
    expect(converted.cases).toContainEqual({
      id: DEBATE_SKIP_ID,
      status: "skipped",
      reason: "vitest status: skipped",
    });
    expect(() =>
      validateCompletionReport(converted, { optionalCaseIds: [DEBATE_SKIP_ID] }),
    ).not.toThrow();
    expect(() =>
      validateCompletionReport(converted, {
        isOptionalCase: (testCase) => testCase.id === DEBATE_SKIP_ID,
      }),
    ).not.toThrow();
  });

  it("fails a run where no required case executed, even if every skip is optional", () => {
    const converted = convertVitestJsonReport(placeholderPayload({ includePassed: false }), {
      suite: "cases",
      optionalCaseIds: [DEBATE_SKIP_ID],
    });

    expect(converted.exitCode).toBe(1);
    expect(converted.cases).toContainEqual(
      expect.objectContaining({ id: "vitest:no-required-executed", status: "failed" }),
    );
    expect(converted.cases).toContainEqual({
      id: DEBATE_SKIP_ID,
      status: "skipped",
      reason: "vitest status: skipped",
    });

    const onlyOptionalSkip = report({
      cases: [{ id: DEBATE_SKIP_ID, status: "skipped", reason: "placeholder" }],
    });
    expect(() =>
      validateCompletionReport(onlyOptionalSkip, { optionalCaseIds: [DEBATE_SKIP_ID] }),
    ).toThrow(/required executed/i);
  });

  it("surfaces payload count mismatches as a failed case", () => {
    const converted = convertVitestJsonReport(
      vitestPayload({
        numTotalTests: 5,
        numPassedTests: 1,
        testResults: [
          {
            assertionResults: [{ fullName: "a", status: "passed", failureMessages: [] }],
            startTime: 1758700000000,
            endTime: 1758700000100,
            status: "passed",
            message: "",
            name: "/repo/tests/evals/cases/x.eval.ts",
          },
        ],
      }),
      { suite: "cases" },
    );

    expect(converted.exitCode).toBe(1);
    expect(converted.cases).toContainEqual(
      expect.objectContaining({ id: "vitest:payload-mismatch", status: "failed" }),
    );
    expect(() => validateCompletionReport(converted)).toThrow(/failed/i);
  });

  it("carries failed assertion messages into a failed case", () => {
    const converted = convertVitestJsonReport(
      vitestPayload({
        numPassedTests: 0,
        numFailedTests: 1,
        numTotalTests: 1,
        success: false,
        testResults: [
          {
            assertionResults: [
              {
                fullName: "router routes equities",
                status: "failed",
                failureMessages: ["AssertionError: expected 1 to be 2"],
              },
            ],
            startTime: 1758700000000,
            endTime: 1758700000100,
            status: "failed",
            message: "",
            name: "/repo/tests/evals/cases/router.eval.ts",
          },
        ],
      }),
      { suite: "cases" },
    );

    expect(converted.cases).toEqual([
      {
        id: "router routes equities",
        status: "failed",
        reason: "AssertionError: expected 1 to be 2",
      },
    ]);
    expect(converted.exitCode).toBe(1);
  });

  it("fails zero-test payloads instead of reporting an empty pass", () => {
    const converted = convertVitestJsonReport(
      vitestPayload({
        numTotalTestSuites: 0,
        numTotalTests: 0,
        numPassedTests: 0,
        numFailedTests: 0,
        success: false,
        testResults: [],
      }),
      { suite: "cases" },
    );

    expect(converted.exitCode).toBe(1);
    expect(converted.cases).toEqual([
      {
        id: "vitest:no-tests",
        status: "failed",
        reason: "Vitest reported zero test cases",
      },
    ]);
    expect(() => validateCompletionReport(converted)).toThrow(/failed/i);
  });

  it("cannot report a passing run when a suite or hook error fails the file", () => {
    const converted = convertVitestJsonReport(
      vitestPayload({
        numPassedTestSuites: 0,
        numFailedTestSuites: 1,
        numTotalTests: 1,
        numPassedTests: 1,
        success: false,
        testResults: [
          {
            assertionResults: [
              { fullName: "router routes equities", status: "passed", failureMessages: [] },
            ],
            startTime: 1758700000000,
            endTime: 1758700000100,
            status: "failed",
            message: "Error: beforeAll hook failed",
            name: "/repo/tests/evals/cases/router.eval.ts",
          },
        ],
      }),
      { suite: "cases" },
    );

    expect(converted.exitCode).toBe(1);
    expect(converted.cases).toContainEqual(
      expect.objectContaining({ status: "failed", reason: "Error: beforeAll hook failed" }),
    );
    expect(() => validateCompletionReport(converted)).toThrow(/failed/i);
  });

  it("fails when the payload reports failures the assertion results do not show", () => {
    const converted = convertVitestJsonReport(
      vitestPayload({ numFailedTestSuites: 1, success: false, testResults: [] }),
      { suite: "cases" },
    );

    expect(converted.exitCode).toBe(1);
    expect(converted.cases.some((testCase) => testCase.status === "failed")).toBe(true);
  });

  it("fails a run Vitest marked unsuccessful even when every assertion passed", () => {
    // e.g. an unhandled error or rejection outside any test: Vitest sets
    // success=false while every assertion result and counter reads as passing.
    const converted = convertVitestJsonReport(vitestPayload({ success: false }), {
      suite: "cases",
    });

    expect(converted.exitCode).toBe(1);
    expect(converted.cases).toContainEqual({
      id: "vitest:run-failed",
      status: "failed",
      reason: "vitest run failed outside test assertions (success=false)",
    });
    expect(converted.cases.filter((testCase) => testCase.status === "failed")).toHaveLength(1);
    expect(() => validateCompletionReport(converted)).toThrow(/failed/i);
  });

  it("does not add a run-level failure when a failure is already recorded", () => {
    const converted = convertVitestJsonReport(
      vitestPayload({
        numPassedTests: 1,
        numFailedTests: 1,
        success: false,
        testResults: [
          {
            assertionResults: [
              { fullName: "router routes equities", status: "passed", failureMessages: [] },
              {
                fullName: "router routes crypto",
                status: "failed",
                failureMessages: ["AssertionError: expected crypto"],
              },
            ],
            startTime: 1758700000000,
            endTime: 1758700000100,
            status: "failed",
            message: "",
            name: "/repo/tests/evals/cases/router.eval.ts",
          },
        ],
      }),
      { suite: "cases" },
    );

    expect(converted.exitCode).toBe(1);
    expect(converted.cases.map((testCase) => testCase.id)).not.toContain("vitest:run-failed");
    expect(converted.cases.filter((testCase) => testCase.status === "failed")).toHaveLength(1);
  });

  it("keeps a passing run passing when Vitest reports success", () => {
    const converted = convertVitestJsonReport(vitestPayload({ success: true }), {
      suite: "cases",
    });

    expect(converted.exitCode).toBe(0);
    expect(converted.cases.map((testCase) => testCase.id)).not.toContain("vitest:run-failed");
  });

  it("disambiguates duplicate test names across files", () => {
    const converted = convertVitestJsonReport(
      vitestPayload({
        numTotalTests: 2,
        testResults: [
          {
            assertionResults: [{ fullName: "same name", status: "passed", failureMessages: [] }],
            startTime: 1758700000000,
            endTime: 1758700000100,
            status: "passed",
            message: "",
            name: "/repo/tests/evals/cases/one.eval.ts",
          },
          {
            assertionResults: [{ fullName: "same name", status: "passed", failureMessages: [] }],
            startTime: 1758700000000,
            endTime: 1758700000100,
            status: "passed",
            message: "",
            name: "/repo/tests/evals/cases/two.eval.ts",
          },
        ],
      }),
      { suite: "cases" },
    );

    const ids = converted.cases.map((testCase) => testCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("sanitizes long multi-line failure messages in reasons", () => {
    const converted = convertVitestJsonReport(
      vitestPayload({
        numFailedTests: 1,
        numTotalTests: 1,
        success: false,
        testResults: [
          {
            assertionResults: [
              { fullName: "a", status: "failed", failureMessages: ["line one\nline two"] },
            ],
            startTime: 1758700000000,
            endTime: 1758700000100,
            status: "failed",
            message: "",
            name: "/repo/tests/evals/cases/x.eval.ts",
          },
        ],
      }),
      { suite: "cases" },
    );

    const failed = converted.cases[0];
    expect(failed.reason).not.toContain("\n");
    expect(() => assertCompletionReportShape(converted)).not.toThrow();
  });
});
