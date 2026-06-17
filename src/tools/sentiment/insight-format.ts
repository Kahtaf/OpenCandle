import type { SentimentInsight } from "../../types/sentiment.js";
import { renderUntrustedText } from "./untrusted-text.js";

export function formatInsightSection(insight: SentimentInsight): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push("Findings:");
  lines.push(
    `- Overall: ${insight.label} (${formatSigned(insight.score)}) from ${insight.sampleSize} records; ${insight.scoredSampleSize} had keyword sentiment evidence.`,
  );
  lines.push(
    `- Confidence: ${insight.confidence.level} (${insight.confidence.score.toFixed(2)})${
      insight.confidence.reasons.length > 0 ? ` — ${insight.confidence.reasons.join("; ")}` : ""
    }`,
  );
  appendDrivers(lines, "Positive drivers", insight.positiveDrivers);
  appendDrivers(lines, "Negative drivers", insight.negativeDrivers);
  appendDrivers(lines, "Mixed drivers", insight.mixedDrivers);
  if (insight.caveats.length > 0) {
    lines.push(`- Caveats: ${insight.caveats.join("; ")}`);
  }
  if (insight.notableClaims.length > 0) {
    lines.push("- Notable source claims:");
    for (const claim of insight.notableClaims.slice(0, 3)) {
      lines.push(`  - ${renderUntrustedText(claim, 140)}`);
    }
  }
  if (insight.representativeItems.length > 0) {
    lines.push(
      `- Representative evidence preview: ${insight.representativeItems.length} shown from ${insight.scoredSampleSize} scored records (${insight.sampleSize} total records).`,
    );
  }
  return lines;
}

function appendDrivers(
  lines: string[],
  label: string,
  drivers: SentimentInsight["positiveDrivers"],
): void {
  if (drivers.length === 0) return;
  const rendered = drivers
    .map((driver) => `${renderUntrustedText(driver.label, 60)} (${driver.count})`)
    .join(", ");
  lines.push(`- ${label}: ${rendered}`);
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}
