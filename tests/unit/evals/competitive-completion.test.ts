import { describe, expect, it } from "vitest";
import { completionCaseForPrompt } from "../../evals/competitive-completion.js";
import type { FinalAnswerAssertionResult } from "../../evals/prompt-policy-assertions.js";

function result(
  assertion: string,
  overrides: Partial<FinalAnswerAssertionResult> = {},
): FinalAnswerAssertionResult {
  return { assertion, passed: true, reason: "ok", deterministic: true, ...overrides };
}

const mismatchCases: Array<[string, string[], FinalAnswerAssertionResult[], RegExp]> = [
  [
    "duplicate expected assertion names",
    ["A", "A"],
    [result("A"), result("A")],
    /duplicate required/i,
  ],
  ["result cardinality mismatch", ["A", "B"], [result("A")], /count/i],
  ["missing expected result", ["A", "B"], [result("A"), result("C")], /do not match/i],
  ["unrelated result set", ["A", "B"], [result("C"), result("D")], /do not match/i],
  [
    "duplicate result assertion names",
    ["A", "B"],
    [result("A"), result("A")],
    /duplicate.*result/i,
  ],
];

describe("frozen competitive prompt completion case", () => {
  it("fails a frozen prompt with no configured required assertions", () => {
    expect(completionCaseForPrompt("p1", [], [])).toEqual({
      id: "p1",
      status: "failed",
      reason: "no required hard assertions configured for frozen prompt",
    });
  });

  it.each(mismatchCases)("fails %s", (_label, expected, results, pattern) => {
    const testCase = completionCaseForPrompt("p1", expected, results);

    expect(testCase.status).toBe("failed");
    expect(testCase.reason).toMatch(pattern);
  });

  it("fails malformed assertion names", () => {
    expect(completionCaseForPrompt("p1", [""], [result("")]).status).toBe("failed");
    expect(
      completionCaseForPrompt(
        "p1",
        ["A"],
        [{ ...result("A"), assertion: undefined as unknown as string }],
      ).status,
    ).toBe("failed");
  });

  it("passes only when every required assertion is present once, deterministic, and passed", () => {
    expect(completionCaseForPrompt("p1", ["A", "B"], [result("A"), result("B")])).toEqual({
      id: "p1",
      status: "passed",
    });
  });

  it("fails a failed deterministic assertion", () => {
    const testCase = completionCaseForPrompt(
      "p1",
      ["A", "B"],
      [result("A"), result("B", { passed: false })],
    );

    expect(testCase.status).toBe("failed");
    expect(testCase.reason).toContain("B");
  });

  it("cannot hide an unknown required checker behind a passing checker", () => {
    const testCase = completionCaseForPrompt(
      "p1",
      ["A", "judge"],
      [result("A"), result("judge", { deterministic: false })],
    );

    expect(testCase.status).toBe("failed");
    expect(testCase.reason).toMatch(/deterministic/i);
    expect(testCase.reason).toContain("judge");
  });

  it("bases the required outcome solely on the required assertions passed in", () => {
    // Optional judge assertions are never passed to this helper.
    expect(completionCaseForPrompt("p1", ["A"], [result("A")])).toEqual({
      id: "p1",
      status: "passed",
    });
  });

  it("truncates long failure reasons to a bounded single line", () => {
    const longName = `rule ${"x".repeat(1200)}`;
    const testCase = completionCaseForPrompt(
      "p1",
      [longName],
      [result(longName, { passed: false })],
    );

    expect(testCase.reason?.length).toBeLessThanOrEqual(900);
    expect(testCase.reason).not.toContain("\n");
  });
});
