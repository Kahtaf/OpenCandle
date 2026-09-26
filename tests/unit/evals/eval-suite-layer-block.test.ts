import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildReport,
  failedLayerNames,
  formatReport,
  saveFailureDiagnostic,
} from "../../evals/baseline.js";
import type { EvalCaseResult, EvalReport, EvalTrace } from "../../evals/types.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const FIXTURE_CONFIG = join("tests", "unit", "evals", "fixtures", "layer-block.vitest.config.ts");
// Absolute entry point so the spawn does not depend on npm's PATH shim (which
// fails to resolve vitest.cmd on Windows). Run under the current node binary,
// no shell.
const VITEST_BIN = join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs");

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "oc-eval-layer-block-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

/**
 * Run one fixture through the real eval registration runner. The fixture mocks
 * only the live agent harness; scoring, layer blocking, reporting, and the
 * diagnostic writer are the production test helpers.
 */
function runFixture(fixture: string, diagnosticsDir: string) {
  return spawnSync(process.execPath, [VITEST_BIN, "run", "--config", FIXTURE_CONFIG, fixture], {
    cwd: REPO_ROOT,
    env: { ...process.env, EVAL_DIAGNOSTICS_DIR: diagnosticsDir },
    encoding: "utf-8",
    timeout: 120_000,
  });
}

function makeTrace(overrides: Partial<EvalTrace> = {}): EvalTrace {
  return {
    prompt: "isolated diagnostic fixture prompt",
    classification: {
      workflow: "single_asset_analysis",
      confidence: 0.95,
      tier: "rule",
      entities: { symbols: ["AAPL"] },
    },
    toolCalls: [],
    askUserTranscript: [],
    text: "",
    ...overrides,
  };
}

function allPass(name: string): EvalCaseResult {
  return {
    name,
    tier: "always",
    score: 1,
    layers: {
      tool_selection: { passed: true, score: 1, message: "All tool checks passed" },
      data_faithfulness: { passed: true, score: 1, message: "All 1 financial numbers grounded" },
    },
    safetyCriticalFailure: false,
  };
}

function partialLayerFailure(name: string): EvalCaseResult {
  return {
    name,
    tier: "always",
    // The preserved quote-accuracy report: 0.875 aggregate clears the 0.8
    // threshold while data_faithfulness has `passed: false`.
    score: 0.875,
    layers: {
      tool_selection: { passed: true, score: 1, message: "All tool checks passed" },
      data_faithfulness: { passed: false, score: 0.75, message: "Ungrounded numbers: 0.33" },
    },
    safetyCriticalFailure: false,
  };
}

describe("failedLayerNames", () => {
  it("returns only the layers that did not pass", () => {
    expect(failedLayerNames(partialLayerFailure("quote-accuracy"))).toEqual(["data_faithfulness"]);
    expect(failedLayerNames(allPass("ratio-accuracy"))).toEqual([]);
  });
});

describe("buildReport regression on failed layers", () => {
  it("flags regression when a layer fails even though the aggregate delta is positive", () => {
    // Mirrors the preserved test-trust integration report: aggregate 95.8% vs
    // baseline 93.0% (delta +2.8%) with quote-accuracy.data_faithfulness failed.
    const report = buildReport([
      partialLayerFailure("quote-accuracy"),
      allPass("ratio-accuracy"),
      allPass("backtest-metrics"),
    ]);

    expect(report.aggregate).toBeCloseTo(0.9583, 3);
    expect(report.delta).not.toBeNull();
    expect(report.delta as number).toBeGreaterThan(0);
    expect(report.regressed).toContain("quote-accuracy");
    expect(report.regression).toBe(true);
  });

  it("stays green when every case has all layers passing", () => {
    const report = buildReport([
      allPass("quote-accuracy"),
      allPass("ratio-accuracy"),
      allPass("backtest-metrics"),
    ]);

    expect(report.aggregate).toBeCloseTo(1, 5);
    expect(report.regression).toBe(false);
  });
});

describe("formatReport truthful per-case status", () => {
  it("labels a case FAIL when a layer failed even though its score clears the threshold", () => {
    const report: EvalReport = {
      cases: [partialLayerFailure("quote-accuracy"), allPass("ratio-accuracy")],
      aggregate: 0.9375,
      baseline: 0.93,
      delta: 0.0075,
      regression: true,
      safetyCriticalFailures: [],
      improved: [],
      regressed: ["quote-accuracy"],
      unchanged: [],
    };

    const text = formatReport(report);

    expect(text).toMatch(/\[FAIL\] quote-accuracy: 87\.5%/);
    expect(text).toMatch(/\[PASS\] ratio-accuracy: 100\.0%/);
    expect(text).toContain("Regression: YES");
    expect(text).toContain("data_faithfulness: ✗");
  });
});

describe("saveFailureDiagnostic", () => {
  it("writes nothing for an all-pass result", () => {
    const dir = makeTempDir();
    const path = saveFailureDiagnostic(allPass("ratio-accuracy"), makeTrace(), { dir });
    expect(path).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("retains response and tool evidence, redacted, for a failed layer", () => {
    const dir = makeTempDir();
    const result = partialLayerFailure("quote-accuracy");
    const trace = makeTrace({
      text: "AAPL trades at $100. session=abc123secret",
      toolCalls: [
        {
          name: "get_quote",
          args: { symbol: "AAPL", access_token: "super-secret-token-value" },
          result: { price: 100, currency: "USD" },
        },
      ],
      askUserTranscript: [{ question: "Which ticker?", answer: "AAPL" }],
    });
    // Layer messages can echo tool args or expected values, so they must be
    // redacted too; the `passed` boolean must survive the pass.
    result.layers.data_faithfulness.message = "Ungrounded numbers: 999 token=leaky-layer-secret";

    const path = saveFailureDiagnostic(result, trace, {
      dir,
      now: new Date("2026-09-25T02:26:47.876Z"),
    });

    expect(path).not.toBeNull();
    const raw = readFileSync(path as string, "utf-8");
    expect(raw).not.toContain("super-secret-token-value");
    expect(raw).not.toContain("abc123secret");
    expect(raw).not.toContain("leaky-layer-secret");

    const artifact = JSON.parse(raw) as {
      case: string;
      failedLayers: string[];
      prompt: string;
      responseText: string;
      layers: Record<string, { passed: boolean; score: number; message?: string }>;
      toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
      askUserTranscript: Array<{ question: string; answer: string }>;
    };
    expect(artifact.case).toBe("quote-accuracy");
    expect(artifact.failedLayers).toEqual(["data_faithfulness"]);
    expect(artifact.responseText).toContain("$100");
    expect(artifact.responseText).toContain("session=[redacted]");
    expect(artifact.layers.data_faithfulness).toMatchObject({ passed: false, score: 0.75 });
    expect(artifact.layers.data_faithfulness.message).toContain("token=[redacted]");
    expect(artifact.toolCalls[0]).toMatchObject({
      name: "get_quote",
      args: { symbol: "AAPL", access_token: "[redacted]" },
      result: { price: 100, currency: "USD" },
    });
    expect(artifact.askUserTranscript[0]).toEqual({ question: "Which ticker?", answer: "AAPL" });

    if (process.platform !== "win32") {
      expect(statSync(path as string).mode & 0o777).toBe(0o600);
    }
  });

  it("redacts a credential named in a natural-language API-key-as provider message", () => {
    const dir = makeTempDir();
    // Synthetic credential only. It mimics the provider wording
    // "We have detected your API key as <value> ...", which the
    // assignment-based sanitizer does not cover.
    const credential = "SYNTHETICEXAMPLE123";
    const responseText = `We have detected your API key as ${credential} and our standard API rate limit is 25 requests per day.`;
    const nestedError = `Provider refused the request: we detected your api Key as ${credential} and our standard API rate limit is 25 requests per day.`;
    const trace = makeTrace({
      text: responseText,
      toolCalls: [
        {
          name: "get_quote",
          args: { symbol: "AAPL" },
          result: { providerError: { message: nestedError } },
          isError: true,
        },
      ],
      customEntries: [
        {
          customType: "opencandle-workflow",
          timestamp: "2026-09-25T00:00:00.000Z",
          data: { workflow: `portfolio_builder (api key as ${credential})` },
        },
        {
          customType: "opencandle-workflow-event",
          timestamp: "2026-09-25T00:00:01.000Z",
          data: {
            eventType: "output_validation_failed",
            stepType: `fetch_candidates (api key as ${credential})`,
          },
        },
        {
          customType: "opencandle-workflow-complete",
          timestamp: "2026-09-25T00:00:02.000Z",
          data: {
            workflow: `portfolio_builder (api key as ${credential})`,
            status: `failed (api key as ${credential})`,
          },
        },
      ],
    });

    const path = saveFailureDiagnostic(partialLayerFailure("quote-accuracy"), trace, { dir });

    expect(path).not.toBeNull();
    const raw = readFileSync(path as string, "utf-8");
    // RED before the fix: the credential appears verbatim in both the serialized
    // response and the nested tool result.
    expect(raw).not.toContain(credential);

    const artifact = JSON.parse(raw) as {
      responseText: string;
      toolCalls: Array<{ result: { providerError: { message: string } } }>;
      workflow?: string;
      workflowTerminalStatus?: string;
      workflowValidationFailedSteps?: string[];
      customEntries?: unknown;
    };
    // The surrounding diagnostic stays readable, case-insensitively.
    expect(artifact.responseText).toContain("We have detected your API key as [redacted]");
    expect(artifact.responseText).toContain(
      "and our standard API rate limit is 25 requests per day",
    );
    expect(artifact.toolCalls[0].result.providerError.message).toContain(
      "we detected your api Key as [redacted]",
    );
    expect(artifact.toolCalls[0].result.providerError.message).not.toContain(credential);

    // The workflow summary fields go through the same redactor, and raw custom
    // entry contents are never serialized into the artifact.
    expect(artifact.workflow).toContain("[redacted]");
    expect(artifact.workflowTerminalStatus).toContain("[redacted]");
    expect(artifact.workflowValidationFailedSteps?.[0]).toContain("[redacted]");
    expect(artifact.customEntries).toBeUndefined();
    expect(raw).not.toContain("customEntries");
    expect(raw).not.toContain("opencandle-workflow-event");
    for (const value of [
      artifact.workflow,
      artifact.workflowTerminalStatus,
      ...(artifact.workflowValidationFailedSteps ?? []),
    ]) {
      expect(value).not.toContain(credential);
    }
  });

  it("caps object entries on retained tool payloads", () => {
    const dir = makeTempDir();
    const bigResult: Record<string, number> = {};
    for (let index = 0; index < 150; index += 1) bigResult[`metric_${index}`] = index;

    const path = saveFailureDiagnostic(
      partialLayerFailure("quote-accuracy"),
      makeTrace({ toolCalls: [{ name: "get_quote", args: {}, result: bigResult }] }),
      { dir },
    );

    expect(path).not.toBeNull();
    const artifact = JSON.parse(readFileSync(path as string, "utf-8")) as {
      toolCalls: Array<{ result: Record<string, number> }>;
    };
    expect(Object.keys(artifact.toolCalls[0].result).length).toBeLessThanOrEqual(100);
  });

  it("records safe workflow terminal status and validation step names", () => {
    const dir = makeTempDir();
    const trace = makeTrace({
      customEntries: [
        {
          customType: "opencandle-workflow",
          timestamp: "2026-09-25T00:00:00.000Z",
          data: { workflow: "portfolio_builder" },
        },
        {
          customType: "opencandle-workflow-event",
          timestamp: "2026-09-25T00:00:01.000Z",
          data: { eventType: "output_validation_failed", stepType: "fetch_candidates" },
        },
        {
          customType: "opencandle-workflow-event",
          timestamp: "2026-09-25T00:00:02.000Z",
          data: {
            eventType: "output_validation_failed",
            stepType: "fetch_candidates",
            repairAttempted: true,
          },
        },
        {
          customType: "opencandle-workflow-complete",
          timestamp: "2026-09-25T00:00:03.000Z",
          data: { workflow: "portfolio_builder", status: "failed" },
        },
      ],
    });

    const path = saveFailureDiagnostic(
      partialLayerFailure("portfolio-builder-conservative"),
      trace,
      { dir },
    );

    expect(path).not.toBeNull();
    const artifact = JSON.parse(readFileSync(path as string, "utf-8")) as {
      workflow?: string;
      workflowTerminalStatus?: string;
      workflowValidationFailedSteps?: string[];
    };
    expect(artifact.workflow).toBe("portfolio_builder");
    expect(artifact.workflowTerminalStatus).toBe("failed");
    expect(artifact.workflowValidationFailedSteps).toEqual(["fetch_candidates"]);
  });

  it("records the workflow failure reason: validation errors per attempt, bounded and redacted", () => {
    const dir = makeTempDir();
    const credential = "sk-live-5a4b3c2d1e0f";
    const trace = makeTrace({
      workflowFailure: {
        workflow: "portfolio_builder",
        terminalStatus: "failed",
        validationAttempts: [
          {
            step: "fetch_candidates",
            attempt: 2,
            repairAttempted: true,
            errors: [`no usable market price evidence (api key as ${credential})`],
          },
        ],
        eventLogFailures: [],
        truncated: false,
      },
    });

    const path = saveFailureDiagnostic(
      partialLayerFailure("portfolio-income-conservative"),
      trace,
      { dir },
    );

    const raw = readFileSync(path as string, "utf-8");
    expect(raw).not.toContain(credential);
    const artifact = JSON.parse(raw) as {
      workflowFailure?: { validationAttempts: Array<{ errors: string[]; attempt: number }> };
    };
    expect(artifact.workflowFailure?.validationAttempts[0]?.attempt).toBe(2);
    expect(artifact.workflowFailure?.validationAttempts[0]?.errors[0]).toContain(
      "no usable market price evidence",
    );
  });

  it("derives the workflow failure reason from session entries when the trace has no summary", () => {
    const dir = makeTempDir();
    const trace = makeTrace({
      customEntries: [
        {
          customType: "opencandle-workflow-event",
          timestamp: "2026-09-25T00:00:02.000Z",
          data: {
            eventType: "output_validation_failed",
            stepType: "fetch_candidates",
            errors: ["no usable market price evidence"],
            repairAttempted: true,
          },
        },
        {
          customType: "opencandle-workflow-complete",
          timestamp: "2026-09-25T00:00:03.000Z",
          data: { workflow: "portfolio_builder", status: "failed" },
        },
      ],
    });

    const path = saveFailureDiagnostic(partialLayerFailure("portfolio"), trace, { dir });

    const artifact = JSON.parse(readFileSync(path as string, "utf-8")) as {
      workflowFailure?: { validationAttempts: Array<{ errors: string[] }> };
    };
    expect(artifact.workflowFailure?.validationAttempts[0]?.errors).toEqual([
      "no usable market price evidence",
    ]);
  });

  it("omits the workflow failure summary for a trace with no failed workflow", () => {
    const dir = makeTempDir();
    const path = saveFailureDiagnostic(partialLayerFailure("quote-accuracy"), makeTrace(), { dir });
    expect(readFileSync(path as string, "utf-8")).not.toContain("workflowFailure");
  });

  it("uses a safe, unique filename that cannot escape the diagnostics directory or overwrite", () => {
    const dir = makeTempDir();
    const now = new Date("2026-09-25T02:26:47.876Z");
    const result = partialLayerFailure("../../etc/passwd evil/name");

    const first = saveFailureDiagnostic(result, makeTrace(), { dir, now });
    const second = saveFailureDiagnostic(result, makeTrace(), { dir, now });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
    for (const path of [first as string, second as string]) {
      const filename = basename(path);
      expect(filename).not.toContain("/");
      expect(filename).not.toContain("..");
      expect(filename).toMatch(
        /^\d{4}-\d{2}-\d{2}T.*_etc-passwd-evil-name_[0-9]+-[a-z0-9]+\.json$/,
      );
    }
    expect(readdirSync(dir)).toHaveLength(2);
  });
});

describe("registered eval runner layer blocking", () => {
  it("exits non-zero for a partially failed layer even when the aggregate clears the threshold, and writes evidence", () => {
    const diagnosticsDir = makeTempDir();
    const run = runFixture("layer-block-fail.fixture.ts", diagnosticsDir);
    const output = `${run.stdout}\n${run.stderr}`;

    expect(run.status).toBe(1);
    expect(output).toContain("data_faithfulness");

    const files = readdirSync(diagnosticsDir);
    expect(files).toHaveLength(1);
    const artifact = JSON.parse(readFileSync(join(diagnosticsDir, files[0]), "utf-8")) as {
      case: string;
      score: number;
      failedLayers: string[];
      responseText: string;
      toolCalls: Array<{ name: string }>;
    };
    expect(artifact.case).toBe("partial-layer");
    expect(artifact.score).toBeCloseTo(0.875, 5);
    expect(artifact.failedLayers).toEqual(["data_faithfulness"]);
    expect(artifact.responseText).toContain("$999");
    expect(artifact.toolCalls[0].name).toBe("get_quote");
  });

  it("passes the all-green control and writes no diagnostic", () => {
    const diagnosticsDir = makeTempDir();
    const run = runFixture("layer-block-pass.fixture.ts", diagnosticsDir);

    expect(`${run.stdout}\n${run.stderr}`).not.toContain("data_faithfulness: ✗");
    expect(run.status).toBe(0);
    expect(readdirSync(diagnosticsDir)).toEqual([]);
  });
});
