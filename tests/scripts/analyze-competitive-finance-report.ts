#!/usr/bin/env tsx
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  analyzeCompetitiveReport,
  competitiveReportAnalysisPath,
  formatCompetitiveReportAnalysisMarkdown,
} from "../evals/competitive-finance.js";

const reportPath = process.argv[2] ?? latestCompetitiveReportPath();
if (!reportPath) {
  throw new Error("No competitive finance report found under tests/evals/runs");
}

const report = JSON.parse(readFileSync(reportPath, "utf-8"));
const analysis = analyzeCompetitiveReport(report, { reportPath });
const markdown = formatCompetitiveReportAnalysisMarkdown(analysis);
const outputPath = competitiveReportAnalysisPath(reportPath);

writeFileSync(outputPath, markdown, "utf-8");
console.log(markdown);
console.log(`Analysis: ${outputPath}`);

function latestCompetitiveReportPath(): string | null {
  const dir = join(process.cwd(), "tests", "evals", "runs");
  let reports: string[];
  try {
    reports = readdirSync(dir)
      .filter((file) => file.endsWith("_competitive-finance.json"))
      .sort();
  } catch {
    return null;
  }
  const latest = reports.at(-1);
  return latest ? join(dir, basename(latest)) : null;
}
