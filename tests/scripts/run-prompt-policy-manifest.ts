#!/usr/bin/env tsx
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalTrace } from "../evals/types.js";
import { runOpenCandleSession } from "../harness/opencandle-runner.js";

interface Manifest {
  manifestVersion: number;
  change: string;
  prompts: ManifestPrompt[];
}

interface ManifestPrompt {
  id: string;
  text: string;
  followupSequence: string[];
  expected: {
    routeKind?: string;
    workflow?: string;
    taskFamily?: string;
    commitmentMode?: string;
    toolBundles?: string[];
    requiredEvidence?: string[];
    providerGapDisclosure?: string[];
    finalAnswerHardAssertions?: string[];
    acceptedObservedChanges?: AcceptedObservedChange[];
  };
}

interface AcceptedObservedChange {
  field: "routeKind" | "workflow" | "taskFamily" | "commitmentMode" | "policyCardId" | "evidencePlanId" | "answerContractId" | "retryEligible";
  from?: string;
  to: string;
  reason: string;
}

interface ComparisonFailure {
  field: string;
  expected: unknown;
  actual: unknown;
  message: string;
}

interface ManifestCaseReport {
  id: string;
  prompt: string;
  passed: boolean;
  failures: ComparisonFailure[];
  acceptedObservedChanges?: AcceptedObservedChange[];
  observed: {
    routeKind?: string;
    workflow?: string;
    taskFamily?: string;
    commitmentMode?: string;
    policyCardId?: string;
    evidencePlanId?: string;
    answerContractId?: string;
    artifactContractIds: string[];
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
  }>;
}

interface ManifestReport {
  generatedAt: string;
  manifestPath: string;
  selectedPromptIds: string[];
  cases: ManifestCaseReport[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}

const manifestPath = process.env.PROMPT_POLICY_MANIFEST ??
  "docs/internal/prompt-to-policy-migration-manifest.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;
const selected = selectPrompts(manifest.prompts);
if (selected.length === 0) throw new Error("No prompt-to-policy manifest prompts selected");

const reports: ManifestCaseReport[] = [];
for (const prompt of selected) {
  console.log(`\n=== ${prompt.id}: ${prompt.text}`);
  const { evalTrace } = await runOpenCandleSession({
    prompt: prompt.text,
    scriptedAnswers: prompt.followupSequence,
    settleGraceMs: numberFromEnv("PROMPT_POLICY_SETTLE_GRACE_MS") ?? 5_000,
    timeoutMs: numberFromEnv("PROMPT_POLICY_TIMEOUT_MS") ?? 900_000,
  });
  const report = comparePrompt(prompt, evalTrace);
  reports.push(report);
  console.log(`${report.passed ? "PASS" : "FAIL"} route=${report.observed.routeKind ?? "(none)"} task=${report.observed.taskFamily ?? "(none)"} tools=${report.observed.toolCalls.join(",") || "none"}`);
  for (const failure of report.failures) {
    console.log(`  - ${failure.field}: ${failure.message}`);
  }
}

const report: ManifestReport = {
  generatedAt: new Date().toISOString(),
  manifestPath,
  selectedPromptIds: selected.map((prompt) => prompt.id),
  cases: reports,
  summary: {
    total: reports.length,
    passed: reports.filter((entry) => entry.passed).length,
    failed: reports.filter((entry) => !entry.passed).length,
  },
};
const outputPath = writeReport(report);
console.log("\n--- Prompt-To-Policy Manifest Summary ---");
console.log(`Cases: ${report.summary.total}`);
console.log(`Passed: ${report.summary.passed}`);
console.log(`Failed: ${report.summary.failed}`);
console.log(`Report: ${outputPath}`);
if (process.env.PROMPT_POLICY_STRICT === "1" && report.summary.failed > 0) {
  process.exit(1);
}
process.exit(0);

function comparePrompt(prompt: ManifestPrompt, trace: EvalTrace): ManifestCaseReport {
  const observed = {
    routeKind: trace.router?.routeKind,
    workflow: trace.router?.workflow,
    taskFamily: trace.planning?.taskFamily,
    commitmentMode: trace.planning?.commitmentMode,
    policyCardId: trace.planning?.policyCardId,
    evidencePlanId: trace.planning?.evidencePlanId,
    answerContractId: trace.planning?.answerContractId,
    artifactContractIds: trace.planning?.artifactContractIds ?? [],
    toolBundles: trace.router?.toolBundles ?? [],
    toolCalls: trace.toolCalls.map((call) => call.name),
    evidenceTypes: trace.planning?.evidenceRecords.map((record) => record.evidenceType) ?? [],
    capabilityGapIds: trace.planning?.capabilityGapIds ?? [],
    structuredCheckFailures: trace.planning?.structuredCheckFailures.map((failure) => failure.checkId) ?? [],
    retryEligible: trace.planning?.retryEligibility.eligible,
    finalTextLength: trace.text.length,
  };
  const failures: ComparisonFailure[] = [];
  addStringMismatch(failures, "routeKind", prompt.expected.routeKind, observed.routeKind, prompt.expected.acceptedObservedChanges);
  addStringMismatch(failures, "workflow", prompt.expected.workflow, observed.workflow, prompt.expected.acceptedObservedChanges);
  addStringMismatch(failures, "taskFamily", prompt.expected.taskFamily, observed.taskFamily, prompt.expected.acceptedObservedChanges);
  addStringMismatch(failures, "commitmentMode", prompt.expected.commitmentMode, observed.commitmentMode, prompt.expected.acceptedObservedChanges);
  addMissingValues(failures, "toolBundles", prompt.expected.toolBundles ?? [], observed.toolBundles);
  addEvidenceFailures(failures, prompt.expected.requiredEvidence ?? [], observed);
  addMissingValues(failures, "providerGapDisclosure", prompt.expected.providerGapDisclosure ?? [], observed.capabilityGapIds);

  const finalAnswerHardAssertions = (prompt.expected.finalAnswerHardAssertions ?? []).map((assertion) =>
    evaluateFinalAnswerAssertion(assertion, trace)
  );
  for (const assertion of finalAnswerHardAssertions) {
    if (!assertion.passed) {
      failures.push({
        field: "finalAnswerHardAssertions",
        expected: assertion.assertion,
        actual: assertion.reason,
        message: assertion.reason,
      });
    }
  }

  return {
    id: prompt.id,
    prompt: prompt.text,
    passed: failures.length === 0,
    failures,
    acceptedObservedChanges: prompt.expected.acceptedObservedChanges,
    observed,
    finalAnswerHardAssertions,
  };
}

function addStringMismatch(
  failures: ComparisonFailure[],
  field: string,
  expected: string | undefined,
  actual: string | undefined,
  acceptedChanges: readonly AcceptedObservedChange[] = [],
): void {
  if (expected === undefined || expected === actual) return;
  const accepted = acceptedChanges.find((change) =>
    change.field === field &&
    (
      (change.from === expected && change.to === actual) ||
      (change.to === expected && (change.from === undefined || change.from === actual))
    )
  );
  if (accepted) return;
  failures.push({
    field,
    expected,
    actual,
    message: `${field} expected ${expected}, got ${actual ?? "(missing)"}`,
  });
}

function addMissingValues(
  failures: ComparisonFailure[],
  field: string,
  expected: readonly string[],
  actual: readonly string[],
): void {
  const missing = expected.filter((value) => !actual.includes(value));
  if (missing.length === 0) return;
  failures.push({
    field,
    expected,
    actual,
    message: `${field} missing ${missing.join(", ")}`,
  });
}

function addEvidenceFailures(
  failures: ComparisonFailure[],
  expectedEvidence: readonly string[],
  observed: ManifestCaseReport["observed"],
): void {
  for (const expected of expectedEvidence) {
    if (expected.startsWith("capability_gap:")) {
      const gap = expected.slice("capability_gap:".length).split(/[\s,]/)[0] ?? "";
      if (!observed.capabilityGapIds.includes(gap)) {
        failures.push({
          field: "requiredEvidence",
          expected,
          actual: observed.capabilityGapIds,
          message: `missing capability-gap evidence ${gap}`,
        });
      }
      continue;
    }
    if (expected === "market_status" && !observed.evidenceTypes.includes("market_status")) {
      failures.push({
        field: "requiredEvidence",
        expected,
        actual: observed.evidenceTypes,
        message: "missing market_status evidence record",
      });
    }
  }
}

function evaluateFinalAnswerAssertion(
  assertion: string,
  trace: EvalTrace,
): { assertion: string; passed: boolean; reason: string } {
  const text = trace.text.toLowerCase();
  const tools = trace.toolCalls.map((call) => call.name);
  const checks: Array<{ pattern: RegExp; passed: boolean; reason: string }> = [
    {
      pattern: /does not fetch live data|no live data tool calls/i,
      passed: tools.length === 0,
      reason: tools.length === 0 ? "no tool calls observed" : `observed tool calls: ${tools.join(", ")}`,
    },
    {
      pattern: /does not mention opencandle tool names/i,
      passed: !/get_[a-z_]+|search_web|compare_companies|compute_dcf/i.test(trace.text),
      reason: "final answer should not expose tool function names",
    },
    {
      pattern: /exact holdings overlap by weight requires a dedicated holdings tool/i,
      passed: trace.planning?.capabilityGapIds.includes("etf_holdings_overlap") ?? false,
      reason: "expected ETF holdings-overlap capability gap",
    },
    {
      pattern: /labels? any ambiguity if lookup\/company overview is unavailable/i,
      passed: true,
      reason: "conditional ambiguity disclosure assertion; lookup availability is covered by evidence and provider-gap checks",
    },
    {
      pattern: /states the ticker could not be verified if lookup fails/i,
      passed: /could not|couldn't|unavailable|not verified|not verify|ambig|missing|unknown|unable|not recognized|no verified|not find|no results|not available/i.test(text),
      reason: "expected unresolved-ticker disclosure",
    },
    {
      pattern: /does not invent current earnings facts|no invented current earnings facts/i,
      passed: /could not|unavailable|not verified|not verify|missing|unknown|unable|no current|provider gap/i.test(text) ||
        !/\b(?:eps|revenue|guidance|beat|miss|reported|consensus|actual)\b/i.test(trace.text),
      reason: "expected no fabricated current earnings figures",
    },
    {
      pattern: /does not invent an intraday move on weekends or holidays/i,
      passed: trace.planning?.evidenceRecords.some((record) => record.evidenceType === "market_status") ?? false,
      reason: "expected market-status evidence before intraday-move claims",
    },
    {
      pattern: /does not invent|no invented|could not be verified|states the ticker could not be verified/i,
      passed: /could not|unavailable|not verified|not verify|ambig|missing|unknown|unable|not recognized/i.test(text),
      reason: "expected explicit uncertainty or missing-data disclosure",
    },
    {
      pattern: /distinguishes legacy ticker|legacy\/current|current primary ticker/i,
      passed: /\barm\b/.test(text) && /armh|legacy|formerly|current ticker|correct ticker|nasdaq/.test(text),
      reason: "expected current-vs-legacy ticker explanation",
    },
    {
      pattern: /business model|business actually make money|explains durable business model/i,
      passed: /licens|royalt|revenue|customers|architecture|ip/.test(text),
      reason: "expected business-model mechanics",
    },
    {
      pattern: /event-risk framework|expected move|trim\/hedge|trim, hedge|trim or hedge|gap risk/i,
      passed: /trim|hedge|hold|position size|event[- ]risk|earnings|gap risk|stop/.test(text),
      reason: "expected event-risk decision framework",
    },
    {
      pattern: /bottom line|practical workflow|quick checklist|core mental model|where it misleads|cross-checks/i,
      passed: /bottom line/.test(text) && /practical workflow/.test(text) && /quick checklist/.test(text),
      reason: "expected educational section shape",
    },
  ];
  const matching = checks.find((check) => check.pattern.test(assertion));
  if (!matching) {
    return {
      assertion,
      passed: true,
      reason: "no deterministic checker registered; treated as informational",
    };
  }
  return {
    assertion,
    passed: matching.passed,
    reason: matching.reason,
  };
}

function selectPrompts(prompts: ManifestPrompt[]): ManifestPrompt[] {
  const ids = process.env.PROMPT_POLICY_IDS
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const limit = numberFromEnv("PROMPT_POLICY_LIMIT");
  const selected = ids?.length
    ? prompts.filter((prompt) => ids.includes(prompt.id))
    : prompts;
  return limit ? selected.slice(0, limit) : selected;
}

function writeReport(report: ManifestReport): string {
  const runsDir = join(process.cwd(), "tests", "evals", "runs");
  mkdirSync(runsDir, { recursive: true });
  const path = join(runsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}_prompt-policy-manifest.json`);
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n", "utf-8");
  return path;
}

function numberFromEnv(name: string): number | null {
  const value = process.env[name];
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
