export interface PromptPolicyCase {
  id: string;
  passed: boolean;
  failures: unknown[];
  acceptedObservedChanges?: PromptPolicyAcceptedObservedChange[];
  observed: {
    routeKind?: string;
    workflow?: string;
    taskFamily?: string;
    commitmentMode?: string;
    policyCardId?: string;
    evidencePlanId?: string;
    answerContractId?: string;
    behaviorMode?: string;
    toolBundles: string[];
    toolCalls: string[];
    evidenceTypes: string[];
    capabilityGapIds: string[];
    structuredCheckFailures: string[];
    retryEligible?: boolean;
    finalTextLength: number;
  };
  finalAnswerHardAssertions: Array<{
    assertion: string;
    passed: boolean;
    reason: string;
    deterministic?: boolean;
  }>;
}

export interface PromptPolicyAcceptedObservedChange {
  field: (typeof stableScalarFields)[number];
  from?: string;
  to: string;
  reason: string;
}

export interface PromptPolicyParityIssue {
  field: string;
  expected: unknown;
  actual: unknown;
  message: string;
}

export interface PromptPolicyParityCase {
  id: string;
  passed: boolean;
  failures: PromptPolicyParityIssue[];
  warnings: PromptPolicyParityIssue[];
}

export interface PromptPolicyParityReport {
  baseLabel: string;
  currentLabel: string;
  cases: PromptPolicyParityCase[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
}

export function comparePromptPolicyReports(input: {
  baseLabel: string;
  currentLabel: string;
  baseCases: readonly PromptPolicyCase[];
  currentCases: readonly PromptPolicyCase[];
  strictToolCalls?: boolean;
}): PromptPolicyParityReport {
  const baseById = indexCases(input.baseCases);
  const currentById = indexCases(input.currentCases);
  const ids = [...new Set([...baseById.keys(), ...currentById.keys()])].sort();
  const cases = ids.map((id): PromptPolicyParityCase => {
    const base = baseById.get(id);
    const current = currentById.get(id);
    const failures: PromptPolicyParityIssue[] = [];
    const warnings: PromptPolicyParityIssue[] = [];

    if (!base) {
      failures.push(
        issue("case", "present in base", "missing", `${id} missing from ${input.baseLabel}`),
      );
      return { id, passed: false, failures, warnings };
    }
    if (!current) {
      failures.push(
        issue("case", "present in current", "missing", `${id} missing from ${input.currentLabel}`),
      );
      return { id, passed: false, failures, warnings };
    }

    if (!base.passed) {
      failures.push(
        issue(
          "basePassed",
          true,
          false,
          `${id} did not pass manifest assertions in ${input.baseLabel}`,
        ),
      );
    }
    if (!current.passed) {
      failures.push(
        issue(
          "currentPassed",
          true,
          false,
          `${id} did not pass manifest assertions in ${input.currentLabel}`,
        ),
      );
    }

    for (const field of stableScalarFields) {
      addScalarMismatch(
        failures,
        warnings,
        field,
        base.observed[field],
        current.observed[field],
        current,
      );
    }
    for (const field of stableSetFields) {
      addSetParityIssues(failures, warnings, field, base.observed[field], current.observed[field]);
    }
    addAssertionMismatches(failures, base, current);

    const toolIssue = compareToolCalls(base.observed.toolCalls, current.observed.toolCalls);
    if (toolIssue) {
      (input.strictToolCalls ? failures : warnings).push({
        ...toolIssue,
        message: `${id}: ${toolIssue.message}`,
      });
    }

    if (
      base.observed.behaviorMode &&
      current.observed.behaviorMode &&
      base.observed.behaviorMode !== current.observed.behaviorMode &&
      !(
        base.observed.behaviorMode === "dual_run" &&
        current.observed.behaviorMode === "replacement_active"
      )
    ) {
      warnings.push(
        issue(
          "behaviorMode",
          base.observed.behaviorMode,
          current.observed.behaviorMode,
          `${id}: behavior mode changed`,
        ),
      );
    }

    return {
      id,
      passed: failures.length === 0,
      failures,
      warnings,
    };
  });

  return {
    baseLabel: input.baseLabel,
    currentLabel: input.currentLabel,
    cases,
    summary: {
      total: cases.length,
      passed: cases.filter((entry) => entry.passed).length,
      failed: cases.filter((entry) => !entry.passed).length,
      warnings: cases.reduce((sum, entry) => sum + entry.warnings.length, 0),
    },
  };
}

const stableScalarFields = [
  "routeKind",
  "workflow",
  "taskFamily",
  "commitmentMode",
  "policyCardId",
  "evidencePlanId",
  "answerContractId",
  "retryEligible",
] as const;

const stableSetFields = [
  "toolBundles",
  "evidenceTypes",
  "capabilityGapIds",
  "structuredCheckFailures",
] as const;

function indexCases(cases: readonly PromptPolicyCase[]): Map<string, PromptPolicyCase> {
  return new Map(cases.map((entry) => [entry.id, entry]));
}

function addScalarMismatch(
  failures: PromptPolicyParityIssue[],
  warnings: PromptPolicyParityIssue[],
  field: (typeof stableScalarFields)[number],
  expected: unknown,
  actual: unknown,
  current: PromptPolicyCase,
): void {
  if (expected === actual) return;
  const accepted = current.acceptedObservedChanges?.find(
    (change) =>
      change.field === field &&
      (change.from === undefined || change.from === expected) &&
      change.to === actual,
  );
  if (accepted) {
    warnings.push(issue(field, expected, actual, `accepted observed change: ${accepted.reason}`));
    return;
  }
  failures.push(issue(field, expected, actual, `${field} changed`));
}

function addSetParityIssues(
  failures: PromptPolicyParityIssue[],
  warnings: PromptPolicyParityIssue[],
  field: (typeof stableSetFields)[number],
  expected: readonly string[],
  actual: readonly string[],
): void {
  const expectedSet = normalizedSet(expected);
  const actualSet = normalizedSet(actual);
  const missing = expectedSet.filter((value) => !actualSet.includes(value));
  const added = actualSet.filter((value) => !expectedSet.includes(value));
  if (missing.length > 0) {
    failures.push(
      issue(
        field,
        expectedSet,
        actualSet,
        `${field} missing baseline values: ${missing.join(", ")}`,
      ),
    );
  }
  if (added.length > 0) {
    warnings.push(
      issue(field, expectedSet, actualSet, `${field} added values: ${added.join(", ")}`),
    );
  }
}

function addAssertionMismatches(
  failures: PromptPolicyParityIssue[],
  base: PromptPolicyCase,
  current: PromptPolicyCase,
): void {
  const currentAssertions = new Map(
    current.finalAnswerHardAssertions.map((entry) => [entry.assertion, entry.passed]),
  );
  for (const assertion of base.finalAnswerHardAssertions) {
    const currentPassed = currentAssertions.get(assertion.assertion);
    if (currentPassed === assertion.passed) continue;
    failures.push(
      issue(
        "finalAnswerHardAssertions",
        { assertion: assertion.assertion, passed: assertion.passed },
        { assertion: assertion.assertion, passed: currentPassed ?? "(missing)" },
        `${base.id}: final-answer assertion status changed`,
      ),
    );
  }
}

function compareToolCalls(
  expected: readonly string[],
  actual: readonly string[],
): PromptPolicyParityIssue | null {
  if (sameArray([...expected], [...actual])) return null;
  return issue("toolCalls", expected, actual, "tool call sequence changed");
}

function normalizedSet(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sameArray(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function issue(
  field: string,
  expected: unknown,
  actual: unknown,
  message: string,
): PromptPolicyParityIssue {
  return { field, expected, actual, message };
}
