import { describe, expect, it, vi } from "vitest";
import { registerEvalSuite } from "../../evals/eval-suite.js";
import { runEvalCase } from "../../evals/runner.js";
import { scoreCase } from "../../evals/score-case.js";

vi.mock("../../evals/runner.js", () => ({
  runEvalCase: vi.fn(async () => ({
    text: "canned answer",
    toolCalls: [],
    interactions: [],
    customEntries: [],
    durationMs: 1,
  })),
}));

vi.mock("../../evals/score-case.js", () => ({
  scoreCase: vi.fn((evalCase: { name: string }) => ({
    name: evalCase.name,
    score: 1,
    safetyCriticalFailure: false,
    layers: {
      layer1: { passed: true, score: 1, message: "ok" },
    },
  })),
}));

vi.mock("../../evals/baseline.js", () => ({
  buildReport: vi.fn(() => ({})),
  formatReport: vi.fn(() => ""),
  saveRun: vi.fn(() => "unused"),
}));

// Regression test for the vitest-evals 0.14 upgrade: describeEval's root
// export changed to (name, options, define) and threw "define is not a
// function" at collection time, breaking every registerEvalSuite caller
// including the always-tier suites. Registering a suite at the top level of
// this file proves collection succeeds; the registered case proves the
// run-score-threshold wiring executes.
registerEvalSuite("eval-suite registration smoke", [
  {
    name: "passing-case",
    prompt: "tell me about AAPL",
    expectations: {},
  } as never,
]);

describe("registerEvalSuite wiring", () => {
  it("ran the registered case through runEvalCase and scoreCase", () => {
    expect(vi.mocked(runEvalCase)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runEvalCase).mock.calls[0][0]).toMatchObject({
      name: "passing-case",
      prompt: "tell me about AAPL",
    });
    expect(vi.mocked(scoreCase)).toHaveBeenCalledTimes(1);
  });
});
