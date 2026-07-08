import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeCompetitiveReport,
  type CompetitiveCaseAnalysis,
  type CompetitiveReportAnalysis,
} from "./competitive-finance.js";

export type CompetitiveReplayRunSummary =
  | CompetitiveReplaySupportedRun
  | CompetitiveReplayUnsupportedRun;

export interface CompetitiveReplaySupportedRun {
  status: "ok";
  ref: string;
  reportPath: string;
  generatedAt?: string;
  promptCount: number;
  openCandleWins: number;
  losses: number;
  ties: number;
  cases: CompetitiveReplayCaseSummary[];
}

export interface CompetitiveReplayUnsupportedRun {
  status: "unsupported";
  ref: string;
  reason: string;
}

export interface CompetitiveReplayCaseSummary {
  id: string;
  prompt: string;
  winner: string;
  openCandleScore: number;
  competitorScores: Record<string, number>;
  scoreGap: number;
  lostTo?: string;
  planning?: CompetitiveCaseAnalysis["planning"];
  toolCalls: string[];
  cachedCompetitors: string[];
}

export type CompetitiveReplayCaseChangeStatus =
  | "improved"
  | "regressed"
  | "unchanged"
  | "current_only"
  | "base_only";

export interface CompetitiveReplayCaseChange {
  id: string;
  prompt: string;
  status: CompetitiveReplayCaseChangeStatus;
  baseOpenCandleScore?: number;
  currentOpenCandleScore?: number;
  scoreDelta?: number;
  baseWinner?: string;
  currentWinner?: string;
  basePlanning?: CompetitiveCaseAnalysis["planning"];
  currentPlanning?: CompetitiveCaseAnalysis["planning"];
  cachedCompetitors: string[];
}

export interface CompetitiveReplayComparison {
  generatedAt: string;
  evalMode: "competitive";
  status: "compared" | "unsupported";
  current: CompetitiveReplayRunSummary;
  base: CompetitiveReplayRunSummary;
  openCandleWinDelta?: number;
  lossDelta?: number;
  tieDelta?: number;
  caseChanges: CompetitiveReplayCaseChange[];
  unsupportedReason?: string;
}

export function summarizeCompetitiveReplayReport(input: {
  ref: string;
  reportPath: string;
  report: unknown;
}): CompetitiveReplaySupportedRun {
  return summarizeCompetitiveAnalysis({
    ref: input.ref,
    analysis: analyzeCompetitiveReport(input.report, { reportPath: input.reportPath }),
  });
}

export function summarizeCompetitiveAnalysis(input: {
  ref: string;
  analysis: CompetitiveReportAnalysis;
}): CompetitiveReplaySupportedRun {
  return {
    status: "ok",
    ref: input.ref,
    reportPath: input.analysis.reportPath ?? "",
    generatedAt: input.analysis.generatedAt,
    promptCount: input.analysis.promptCount,
    openCandleWins: input.analysis.openCandleWins,
    losses: input.analysis.losses,
    ties: input.analysis.ties,
    cases: input.analysis.cases.map(summarizeCase).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function unsupportedCompetitiveReplayRun(
  ref: string,
  reason: string,
): CompetitiveReplayUnsupportedRun {
  return { status: "unsupported", ref, reason };
}

export function buildCompetitiveReplayComparison(input: {
  current: CompetitiveReplayRunSummary;
  base: CompetitiveReplayRunSummary;
  generatedAt?: string;
}): CompetitiveReplayComparison {
  if (input.current.status === "unsupported" || input.base.status === "unsupported") {
    const unsupported = input.current.status === "unsupported" ? input.current : input.base;
    return {
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      evalMode: "competitive",
      status: "unsupported",
      current: input.current,
      base: input.base,
      caseChanges: [],
      unsupportedReason: unsupported.reason,
    };
  }

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    evalMode: "competitive",
    status: "compared",
    current: input.current,
    base: input.base,
    openCandleWinDelta: input.current.openCandleWins - input.base.openCandleWins,
    lossDelta: input.current.losses - input.base.losses,
    tieDelta: input.current.ties - input.base.ties,
    caseChanges: compareCases(input.current.cases, input.base.cases),
  };
}

export function writeCompetitiveReplayComparisonReport(
  report: CompetitiveReplayComparison,
  cwd = process.cwd(),
): string {
  const runsDir = join(cwd, "tests", "evals", "runs");
  mkdirSync(runsDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const outputPath = join(runsDir, `${stamp}_competitive-replay-comparison.json`);
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return outputPath;
}

export function findLatestCompetitiveReport(cwd = process.cwd()): string | null {
  const runsDir = join(cwd, "tests", "evals", "runs");
  let files: string[];
  try {
    files = readdirSync(runsDir);
  } catch {
    return null;
  }

  const reports = files.filter((file) => file.endsWith("_competitive-finance.json")).sort();
  const latest = reports.at(-1);
  return latest ? join(runsDir, latest) : null;
}

function summarizeCase(result: CompetitiveCaseAnalysis): CompetitiveReplayCaseSummary {
  return {
    id: result.id,
    prompt: result.prompt,
    winner: result.winner,
    openCandleScore: result.openCandleScore,
    competitorScores: { ...result.competitorScores },
    scoreGap: result.scoreGap,
    lostTo: result.lostTo,
    planning: result.planning,
    toolCalls: [...result.toolCalls],
    cachedCompetitors: [...result.cachedCompetitors].sort(),
  };
}

function compareCases(
  currentCases: CompetitiveReplayCaseSummary[],
  baseCases: CompetitiveReplayCaseSummary[],
): CompetitiveReplayCaseChange[] {
  const currentById = new Map(currentCases.map((entry) => [entry.id, entry]));
  const baseById = new Map(baseCases.map((entry) => [entry.id, entry]));
  const ids = [...new Set([...baseById.keys(), ...currentById.keys()])].sort();

  return ids.map((id) => {
    const current = currentById.get(id);
    const base = baseById.get(id);
    if (!current && base) {
      return {
        id,
        prompt: base.prompt,
        status: "base_only",
        baseOpenCandleScore: base.openCandleScore,
        baseWinner: base.winner,
        basePlanning: base.planning,
        cachedCompetitors: [...base.cachedCompetitors],
      };
    }
    if (current && !base) {
      return {
        id,
        prompt: current.prompt,
        status: "current_only",
        currentOpenCandleScore: current.openCandleScore,
        currentWinner: current.winner,
        currentPlanning: current.planning,
        cachedCompetitors: [...current.cachedCompetitors],
      };
    }
    if (!current || !base) {
      throw new Error(`Unexpected missing competitive replay case ${id}`);
    }

    const scoreDelta = current.openCandleScore - base.openCandleScore;
    return {
      id,
      prompt: current.prompt,
      status: caseStatus(scoreDelta, current.winner, base.winner),
      baseOpenCandleScore: base.openCandleScore,
      currentOpenCandleScore: current.openCandleScore,
      scoreDelta,
      baseWinner: base.winner,
      currentWinner: current.winner,
      basePlanning: base.planning,
      currentPlanning: current.planning,
      cachedCompetitors: unique([...base.cachedCompetitors, ...current.cachedCompetitors]).sort(),
    };
  });
}

function caseStatus(
  scoreDelta: number,
  currentWinner: string,
  baseWinner: string,
): CompetitiveReplayCaseChangeStatus {
  if (currentWinner === "opencandle" && baseWinner !== "opencandle") return "improved";
  if (currentWinner !== "opencandle" && baseWinner === "opencandle") return "regressed";
  if (scoreDelta > 0) return "improved";
  if (scoreDelta < 0) return "regressed";
  return "unchanged";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
