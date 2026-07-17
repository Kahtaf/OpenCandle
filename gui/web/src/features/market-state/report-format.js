import { formatHumanDateTime } from "./format.js";

const ISO_TIMESTAMP_PATTERN = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;

export function humanizeReportMarkdown(markdown, timeZone) {
  return String(markdown ?? "")
    .replace(ISO_TIMESTAMP_PATTERN, (timestamp) => {
      return formatHumanDateTime(timestamp, timeZone) || timestamp;
    })
    .replace(/\bTarget watchlist:\s*Default\b/gi, "Target watchlist: My watchlist");
}

export function reportRunTitle(run) {
  const explicitTitle = run?.summaryJson?.title;
  if (typeof explicitTitle === "string" && explicitTitle.trim()) return explicitTitle.trim();
  const text = run?.summaryJson?.text;
  if (typeof text !== "string") return "Morning report";
  const firstLine = text.split(/\r?\n/).find((line) => line.trim());
  const normalized = String(firstLine ?? "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .trim();
  return normalized || "Morning report";
}

export function reportStatusLabel(status) {
  if (status === "completed") return "Done";
  const label = String(status ?? "").trim();
  return label ? `${label[0].toUpperCase()}${label.slice(1).toLowerCase()}` : "Unknown";
}
