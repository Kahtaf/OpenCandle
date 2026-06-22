import type { DoctorCheck, DoctorCheckStatus, DoctorReport } from "./report.js";

const STATUS_SYMBOLS: Record<DoctorCheckStatus, string> = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
  skip: "SKIP",
  unknown: "INFO",
};

export function renderDoctorReport(report: DoctorReport): string {
  const lines = [
    `OpenCandle health: ${report.status.toUpperCase()}`,
    report.summary,
    `Generated: ${report.generatedAt}`,
    `OC home: ${report.metadata.opencandleHome} (${report.metadata.opencandleHomeSource})`,
    `CWD: ${report.metadata.cwd}`,
    "",
  ];

  for (const section of report.sections) {
    lines.push(`${section.label} - ${section.status.toUpperCase()}`);
    for (const check of section.checks) {
      lines.push(`  [${STATUS_SYMBOLS[check.status]}] ${check.label}: ${check.summary}`);
      if (isActionable(check)) {
        lines.push(`      Fix: ${check.remediation}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function isActionable(check: DoctorCheck): boolean {
  return check.status !== "pass" && Boolean(check.remediation);
}
