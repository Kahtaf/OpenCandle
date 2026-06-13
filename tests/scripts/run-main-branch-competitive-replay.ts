#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import {
  buildCompetitiveReplayComparison,
  summarizeCompetitiveReplayReport,
  unsupportedCompetitiveReplayRun,
  writeCompetitiveReplayComparisonReport,
} from "../evals/main-branch-competitive-replay.js";

interface CliOptions {
  currentReport?: string;
  baseReport?: string;
  currentRef: string;
  baseRef: string;
  unsupportedBaseReason?: string;
}

const options = parseArgs(process.argv.slice(2));
if (!options.currentReport) {
  throw new Error(
    "Usage: run-main-branch-competitive-replay --current-report <path> (--base-report <path> | --unsupported-base-reason <reason>) [--current-ref HEAD] [--base-ref origin/main]",
  );
}

const current = summarizeCompetitiveReplayReport({
  ref: options.currentRef,
  reportPath: options.currentReport,
  report: readJson(options.currentReport),
});
const base = options.baseReport
  ? summarizeCompetitiveReplayReport({
      ref: options.baseRef,
      reportPath: options.baseReport,
      report: readJson(options.baseReport),
    })
  : unsupportedCompetitiveReplayRun(
      options.baseRef,
      options.unsupportedBaseReason ?? "base competitive report was not supplied",
    );

const comparison = buildCompetitiveReplayComparison({ current, base });
const outputPath = writeCompetitiveReplayComparisonReport(comparison);

console.log(`Competitive replay status: ${comparison.status}`);
if (comparison.status === "compared") {
  console.log(`OpenCandle win delta: ${comparison.openCandleWinDelta}`);
  console.log(`Loss delta: ${comparison.lossDelta}`);
  console.log(`Tie delta: ${comparison.tieDelta}`);
} else {
  console.log(`Unsupported: ${comparison.unsupportedReason}`);
}
console.log(`Report: ${outputPath}`);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    currentRef: "HEAD",
    baseRef: "origin/main",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--current-report" && next) {
      options.currentReport = next;
      index += 1;
    } else if (arg === "--base-report" && next) {
      options.baseReport = next;
      index += 1;
    } else if (arg === "--current-ref" && next) {
      options.currentRef = next;
      index += 1;
    } else if (arg === "--base-ref" && next) {
      options.baseRef = next;
      index += 1;
    } else if (arg === "--unsupported-base-reason" && next) {
      options.unsupportedBaseReason = next;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  return options;
}
