export type BaselineComparisonField =
  | "routeKind"
  | "workflow"
  | "toolCalls"
  | "providerGapDisclosure"
  | "finalAnswerHardAssertions";

export interface PromptMigrationManifestEntry {
  id: string;
  expected: {
    routeKind?: string;
    workflow?: string;
    toolBundles?: string[];
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

export function buildCapabilityScorecard(
  entries: readonly Pick<PromptMigrationManifestEntry, "id" | "expected">[],
  options: { implementedCapabilityGaps?: readonly string[] } = {},
): CapabilityScorecardEntry[] {
  const implemented = new Set(options.implementedCapabilityGaps ?? []);
  const byGap = new Map<string, Set<string>>();

  for (const entry of entries) {
    for (const gap of entry.expected.providerGapDisclosure ?? []) {
      if (!byGap.has(gap)) byGap.set(gap, new Set());
      byGap.get(gap)!.add(entry.id);
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
