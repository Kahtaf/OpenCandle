export type BaselineComparisonField =
  | "routeKind"
  | "workflow"
  | "toolCalls"
  | "providerGapDisclosure"
  | "finalAnswerHardAssertions"
  | "planning";

export interface PromptMigrationManifestEntry {
  id: string;
  expected: {
    routeKind?: string;
    workflow?: string;
    toolBundles?: string[];
    requiredEvidence?: string[];
    providerGapDisclosure?: string[];
    finalAnswerHardAssertions?: string[];
  };
}

export interface AcceptedImprovement {
  field: BaselineComparisonField;
  reason: string;
}

export interface ObservedMigrationResult {
  routeKind?: string;
  workflow?: string;
  toolCalls: string[];
  providerGapDisclosure: string[];
  finalAnswerHardAssertionsPassed: string[];
  acceptedImprovements?: AcceptedImprovement[];
  planning?: {
    taskFamily?: string;
    evidencePlanId?: string;
    structuredCheckFailures?: Array<{ checkId?: string }>;
    retryEligible?: boolean;
  };
  parityStatus?: string;
  regressionClassification?: string;
}

export interface BaselineComparisonFailure {
  field: BaselineComparisonField;
  expected: unknown;
  actual: unknown;
  message: string;
}

export interface BaselineComparisonResult {
  passed: boolean;
  failures: BaselineComparisonFailure[];
  acceptedImprovements: AcceptedImprovement[];
}

export type CapabilityScorecardStatus =
  | "honest_disclosed_not_specialist_competitive"
  | "specialist_competitive";

export interface CapabilityScorecardEntry {
  capabilityGapId: string;
  promptIds: string[];
  status: CapabilityScorecardStatus;
}

export interface MigrationComparisonReport {
  cases: MigrationComparisonCase[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}

export interface MigrationComparisonCase {
  promptId: string;
  passed: boolean;
  failures: BaselineComparisonFailure[];
  acceptedImprovements: AcceptedImprovement[];
  planning?: ObservedMigrationResult["planning"];
  parityStatus: string;
  regressionClassification: string;
}

export interface MultiTurnPlanningAssertionInput {
  expected: {
    carryoverTaskFamily?: string;
    replacedEntity?: string;
    staleEvidenceInvalidated?: boolean;
    clarificationRequired?: boolean;
  };
  observed: {
    taskFamily?: string;
    entities?: string[];
    staleEvidenceInvalidated?: boolean;
    clarificationAsked?: boolean;
  };
}

export interface MultiTurnPlanningAssertionFailure {
  requirement:
    | "plan_carryover"
    | "entity_replacement"
    | "stale_evidence_invalidation"
    | "ambiguous_followup_clarification";
  message: string;
}

export function compareMigrationBaseline(
  entry: PromptMigrationManifestEntry,
  observed: ObservedMigrationResult,
): BaselineComparisonResult {
  const accepted = observed.acceptedImprovements ?? [];
  const failures: BaselineComparisonFailure[] = [];

  addMismatch(failures, "routeKind", entry.expected.routeKind, observed.routeKind);
  addMismatch(failures, "workflow", entry.expected.workflow, observed.workflow);

  if ((entry.expected.toolBundles ?? []).length === 0 && observed.toolCalls.length > 0) {
    failures.push({
      field: "toolCalls",
      expected: [],
      actual: observed.toolCalls,
      message: `${entry.id} called tools where the baseline expects no active tool bundle`,
    });
  }

  addMissingValues(
    failures,
    "providerGapDisclosure",
    entry.expected.providerGapDisclosure ?? [],
    observed.providerGapDisclosure,
  );
  addMissingValues(
    failures,
    "finalAnswerHardAssertions",
    entry.expected.finalAnswerHardAssertions ?? [],
    observed.finalAnswerHardAssertionsPassed,
  );

  const unacceptedFailures = failures.filter(
    (failure) => !accepted.some((improvement) => improvement.field === failure.field),
  );

  return {
    passed: unacceptedFailures.length === 0,
    failures: unacceptedFailures,
    acceptedImprovements: failures.length === unacceptedFailures.length ? [] : accepted,
  };
}

export function buildMigrationComparisonReport(input: {
  entries: readonly PromptMigrationManifestEntry[];
  observed: Record<string, ObservedMigrationResult | undefined>;
}): MigrationComparisonReport {
  const cases = input.entries.map((entry): MigrationComparisonCase => {
    const observed = input.observed[entry.id] ?? {
      toolCalls: [],
      providerGapDisclosure: [],
      finalAnswerHardAssertionsPassed: [],
    };
    const comparison = compareMigrationBaseline(entry, observed);
    return {
      promptId: entry.id,
      passed: comparison.passed,
      failures: comparison.failures,
      acceptedImprovements: comparison.acceptedImprovements,
      planning: observed.planning,
      parityStatus: observed.parityStatus ?? "unknown",
      regressionClassification:
        observed.regressionClassification ?? (comparison.passed ? "none" : "unreviewed_regression"),
    };
  });

  return {
    cases,
    summary: {
      total: cases.length,
      passed: cases.filter((entry) => entry.passed).length,
      failed: cases.filter((entry) => !entry.passed).length,
    },
  };
}

export function evaluateMultiTurnPlanningAssertions(
  input: MultiTurnPlanningAssertionInput,
): MultiTurnPlanningAssertionFailure[] {
  const failures: MultiTurnPlanningAssertionFailure[] = [];
  if (
    input.expected.carryoverTaskFamily !== undefined &&
    input.observed.taskFamily !== input.expected.carryoverTaskFamily
  ) {
    failures.push({
      requirement: "plan_carryover",
      message: `Expected carried task family ${input.expected.carryoverTaskFamily}, got ${input.observed.taskFamily ?? "(missing)"}`,
    });
  }
  if (
    input.expected.replacedEntity !== undefined &&
    !(input.observed.entities ?? []).includes(input.expected.replacedEntity)
  ) {
    failures.push({
      requirement: "entity_replacement",
      message: `Expected replacement entity ${input.expected.replacedEntity} in observed entities.`,
    });
  }
  if (
    input.expected.staleEvidenceInvalidated === true &&
    input.observed.staleEvidenceInvalidated !== true
  ) {
    failures.push({
      requirement: "stale_evidence_invalidation",
      message: "Expected stale evidence to be invalidated for the followup.",
    });
  }
  if (input.expected.clarificationRequired === true && input.observed.clarificationAsked !== true) {
    failures.push({
      requirement: "ambiguous_followup_clarification",
      message: "Expected an ambiguous followup to ask for clarification.",
    });
  }
  return failures;
}

export function buildCapabilityScorecard(
  entries: readonly Pick<PromptMigrationManifestEntry, "id" | "expected">[],
  options: { implementedCapabilityGaps?: readonly string[] } = {},
): CapabilityScorecardEntry[] {
  const implemented = new Set(options.implementedCapabilityGaps ?? []);
  const byGap = new Map<string, Set<string>>();

  for (const entry of entries) {
    for (const gap of entry.expected.providerGapDisclosure ?? []) {
      if (!byGap.has(gap)) byGap.set(gap, new Set());
      byGap.get(gap)?.add(entry.id);
    }
  }

  return [...byGap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([capabilityGapId, promptIds]) => ({
      capabilityGapId,
      promptIds: [...promptIds].sort(),
      status: implemented.has(capabilityGapId)
        ? "specialist_competitive"
        : "honest_disclosed_not_specialist_competitive",
    }));
}

function addMismatch(
  failures: BaselineComparisonFailure[],
  field: "routeKind" | "workflow",
  expected: string | undefined,
  actual: string | undefined,
): void {
  if (expected === undefined || expected === actual) return;
  failures.push({
    field,
    expected,
    actual,
    message: `${field} changed from ${expected} to ${actual ?? "(missing)"}`,
  });
}

function addMissingValues(
  failures: BaselineComparisonFailure[],
  field: "providerGapDisclosure" | "finalAnswerHardAssertions",
  expected: readonly string[],
  actual: readonly string[],
): void {
  const missing = expected.filter((value) => !actual.includes(value));
  if (missing.length === 0) return;
  failures.push({
    field,
    expected,
    actual,
    message: `${field} missing required values: ${missing.join(", ")}`,
  });
}
