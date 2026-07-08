import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CompetitiveReplayComparison } from "./main-branch-competitive-replay.js";
import type { ProductReplayComparison } from "./main-branch-replay.js";

export type OcSuperiorityStatus =
  | "better_than_main"
  | "at_main_parity"
  | "below_main_parity"
  | "incomplete";

export type ScorecardLayerId =
  | "productReplay"
  | "competitiveReplay"
  | "promptPolicy"
  | "architectureSignals";

export interface ScorecardLayer {
  status: "pass" | "fail" | "incomplete";
  reasons: string[];
  reportPaths: string[];
}

export interface ScorecardBlocker {
  layer: ScorecardLayerId;
  reason: string;
}

export interface OcSuperiorityScorecard {
  generatedAt: string;
  status: OcSuperiorityStatus;
  layers: Record<ScorecardLayerId, ScorecardLayer>;
  blockers: ScorecardBlocker[];
  improvements: string[];
}

export interface PromptPolicyManifestLike {
  manifestPath?: string;
  summary?: {
    total?: number;
    passed?: number;
    failed?: number;
  };
  promptBudget?: {
    totalSectionBudget?: number;
    ceiling?: number;
  };
  cases?: unknown[];
}

export interface BuildOcSuperiorityScorecardInput {
  generatedAt?: string;
  productReplay?: ProductReplayComparison;
  competitiveReplay?: CompetitiveReplayComparison;
  promptPolicy?: PromptPolicyManifestLike;
}

export function buildOcSuperiorityScorecard(
  input: BuildOcSuperiorityScorecardInput,
): OcSuperiorityScorecard {
  const layers = {
    productReplay: classifyProductReplay(input.productReplay),
    competitiveReplay: classifyCompetitiveReplay(input.competitiveReplay),
    promptPolicy: classifyPromptPolicy(input.promptPolicy),
    architectureSignals: classifyArchitectureSignals(input.promptPolicy),
  };
  const blockers = blockersFromLayers(layers);
  const improvements = [
    ...productImprovements(input.productReplay),
    ...competitiveImprovements(input.competitiveReplay),
  ];

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: classifyOverallStatus(layers, blockers, improvements),
    layers,
    blockers,
    improvements,
  };
}

export function writeOcSuperiorityScorecard(
  scorecard: OcSuperiorityScorecard,
  cwd = process.cwd(),
): string {
  const runsDir = join(cwd, "tests", "evals", "runs");
  mkdirSync(runsDir, { recursive: true });
  const stamp = scorecard.generatedAt.replace(/[:.]/g, "-");
  const outputPath = join(runsDir, `${stamp}_oc-superiority-scorecard.json`);
  writeFileSync(outputPath, `${JSON.stringify(scorecard, null, 2)}\n`, "utf-8");
  return outputPath;
}

function classifyProductReplay(report: ProductReplayComparison | undefined): ScorecardLayer {
  if (!report) return incomplete("product replay report missing");
  const paths = reportPathsFromRunSummary(report.current, report.base);
  if (report.status === "unsupported") {
    return {
      status: "incomplete",
      reasons: [report.unsupportedReason ?? "product replay unsupported"],
      reportPaths: paths,
    };
  }
  const reasons: string[] = [];
  if ((report.aggregateDelta ?? 0) < 0)
    reasons.push(`product replay aggregate regressed by ${report.aggregateDelta}`);
  if ((report.passDelta ?? 0) < 0)
    reasons.push(`product replay pass count regressed by ${report.passDelta}`);
  const regressedCases = report.caseChanges.filter((entry) => entry.status === "regressed");
  if (regressedCases.length > 0)
    reasons.push(
      `product replay regressed cases: ${regressedCases.map((entry) => entry.id).join(", ")}`,
    );
  return { status: reasons.length > 0 ? "fail" : "pass", reasons, reportPaths: paths };
}

function classifyCompetitiveReplay(
  report: CompetitiveReplayComparison | undefined,
): ScorecardLayer {
  if (!report) return incomplete("competitive replay report missing");
  const paths = reportPathsFromRunSummary(report.current, report.base);
  if (report.status === "unsupported") {
    return {
      status: "incomplete",
      reasons: [report.unsupportedReason ?? "competitive replay unsupported"],
      reportPaths: paths,
    };
  }
  const reasons: string[] = [];
  if ((report.openCandleWinDelta ?? 0) < 0)
    reasons.push(`competitive OpenCandle wins regressed by ${report.openCandleWinDelta}`);
  if ((report.lossDelta ?? 0) > 0)
    reasons.push(`competitive losses increased by ${report.lossDelta}`);
  const regressedCases = report.caseChanges.filter((entry) => entry.status === "regressed");
  if (regressedCases.length > 0)
    reasons.push(
      `competitive regressed prompts: ${regressedCases.map((entry) => entry.id).join(", ")}`,
    );
  return { status: reasons.length > 0 ? "fail" : "pass", reasons, reportPaths: paths };
}

function classifyPromptPolicy(report: PromptPolicyManifestLike | undefined): ScorecardLayer {
  if (!report) return incomplete("prompt-policy manifest report missing");
  const failed = Number(report.summary?.failed ?? 0);
  const reason =
    failed > 0
      ? [`prompt-policy manifest has ${failed} failed case${failed === 1 ? "" : "s"}`]
      : [];
  return {
    status: reason.length > 0 ? "fail" : "pass",
    reasons: reason,
    reportPaths: report.manifestPath ? [report.manifestPath] : [],
  };
}

function classifyArchitectureSignals(report: PromptPolicyManifestLike | undefined): ScorecardLayer {
  if (!report) return incomplete("prompt-policy manifest report missing for architecture signals");
  const cases = Array.isArray(report.cases) ? report.cases : [];
  const observed = cases.flatMap((entry) => {
    if (!isRecord(entry) || !isRecord(entry.observed)) return [];
    return [entry.observed];
  });
  const hasPlanning = observed.some(
    (entry) => typeof entry.taskFamily === "string" || typeof entry.policyCardId === "string",
  );
  const hasArtifactContracts = observed.some(
    (entry) => Array.isArray(entry.artifactContractIds) && entry.artifactContractIds.length > 0,
  );
  const hasEvidenceTypes = observed.some(
    (entry) => Array.isArray(entry.evidenceTypes) && entry.evidenceTypes.length > 0,
  );
  const structuredFailures = observed.flatMap((entry) =>
    Array.isArray(entry.structuredCheckFailures)
      ? entry.structuredCheckFailures.filter((item): item is string => typeof item === "string")
      : [],
  );
  const reasons: string[] = [];
  if (!hasPlanning) reasons.push("planning metadata missing from prompt-policy report");
  if (!hasArtifactContracts && !hasEvidenceTypes) {
    reasons.push("artifact-contract or evidence-plan signals missing from prompt-policy report");
  }
  const blockingReasons = [...reasons];
  const totalSectionBudget = Number(report.promptBudget?.totalSectionBudget ?? 0);
  const promptBudgetCeiling = Number(report.promptBudget?.ceiling ?? 0);
  if (
    totalSectionBudget > 0 &&
    promptBudgetCeiling > 0 &&
    totalSectionBudget > promptBudgetCeiling
  ) {
    const reason = `prompt section budget ${totalSectionBudget} exceeds ceiling ${promptBudgetCeiling}`;
    reasons.push(reason);
    blockingReasons.push(reason);
  }
  if (structuredFailures.length > 0) {
    reasons.push(
      `observe-only structured check failures observed: ${[...new Set(structuredFailures)].join(", ")}`,
    );
    reasons.push(
      "structured diagnostics use regex-inferred final-answer metadata; keep them observe-only until typed metadata is available",
    );
  }
  return {
    status: blockingReasons.length > 0 ? "fail" : "pass",
    reasons,
    reportPaths: report.manifestPath ? [report.manifestPath] : [],
  };
}

function classifyOverallStatus(
  layers: Record<ScorecardLayerId, ScorecardLayer>,
  blockers: ScorecardBlocker[],
  improvements: string[],
): OcSuperiorityStatus {
  if (Object.values(layers).some((layer) => layer.status === "incomplete")) return "incomplete";
  if (blockers.length > 0) return "below_main_parity";
  return improvements.length > 0 ? "better_than_main" : "at_main_parity";
}

function blockersFromLayers(layers: Record<ScorecardLayerId, ScorecardLayer>): ScorecardBlocker[] {
  return (Object.entries(layers) as Array<[ScorecardLayerId, ScorecardLayer]>).flatMap(
    ([layer, result]) =>
      result.status === "fail" ? result.reasons.map((reason) => ({ layer, reason })) : [],
  );
}

function productImprovements(report: ProductReplayComparison | undefined): string[] {
  if (report?.status !== "compared") return [];
  const improvements: string[] = [];
  if ((report.aggregateDelta ?? 0) > 0)
    improvements.push(`product replay aggregate improved by ${report.aggregateDelta}`);
  if ((report.passDelta ?? 0) > 0)
    improvements.push(`product replay pass count improved by ${report.passDelta}`);
  return improvements;
}

function competitiveImprovements(report: CompetitiveReplayComparison | undefined): string[] {
  if (report?.status !== "compared") return [];
  const improvements: string[] = [];
  if ((report.openCandleWinDelta ?? 0) > 0)
    improvements.push(
      `competitive replay OpenCandle wins improved by ${report.openCandleWinDelta}`,
    );
  if ((report.lossDelta ?? 0) < 0)
    improvements.push(`competitive replay losses improved by ${Math.abs(report.lossDelta ?? 0)}`);
  return improvements;
}

function incomplete(reason: string): ScorecardLayer {
  return { status: "incomplete", reasons: [reason], reportPaths: [] };
}

function reportPathsFromRunSummary(...runs: Array<{ reportPath?: string }>): string[] {
  return runs.flatMap((run) => (run.reportPath ? [run.reportPath] : []));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
