import type { PortfolioLotRecord, ReportRunRecord, WatchlistItemRecord } from "./service.js";

export function formatPortfolioSummary(lots: PortfolioLotRecord[], limit = 8): string[] {
  if (lots.length === 0) return [];
  const lines = ["Portfolio lots:"];
  for (const lot of lots.slice(0, limit)) {
    const costBasis = formatMoney(lot.quantity * lot.avgCost, lot.currency);
    const name = lot.name ? ` (${lot.name})` : "";
    lines.push(
      `- ${lot.symbol}: ${lot.quantity} @ ${formatMoney(lot.avgCost, lot.currency)}, cost basis ${costBasis}${name}`,
    );
  }
  return lines;
}

export function formatWatchlistSummary(items: WatchlistItemRecord[], limit = 8): string[] {
  if (items.length === 0) return [];
  const lines = ["Watchlist:"];
  for (const item of items.slice(0, limit)) {
    lines.push(`- ${item.symbol}${item.name ? ` (${item.name})` : ""}`);
  }
  return lines;
}

export function formatLatestReportSummary(
  report: ReportRunRecord | undefined,
  options: { includeSummary?: boolean } = {},
): string[] {
  if (!report) return [];
  const completed = report.completedAt ?? report.startedAt;
  const summary = options.includeSummary === false ? "" : formatJsonSummary(report.summaryJson);
  const lines = [
    `Latest report run: ${report.status} at ${completed}${summary ? ` — ${summary}` : ""}`,
  ];
  const reportText = options.includeSummary === false ? "" : extractReportText(report.summaryJson);
  if (reportText) lines.push("Report text:", truncateText(reportText, 8_000));
  return lines;
}

export function formatMoney(value: number, currency: string): string {
  const normalized = currency.toUpperCase();
  if (normalized === "USD") return `$${value.toFixed(2)}`;
  return `${normalized} ${value.toFixed(2)}`;
}

export function formatJsonSummary(value: unknown): string {
  if (value == null) return "";
  const json = JSON.stringify(value);
  if (json.length <= 90) return json;
  return `${json.slice(0, 87)}...`;
}

function extractReportText(value: unknown): string {
  if (!value || typeof value !== "object" || !("text" in value)) return "";
  const text = (value as { text?: unknown }).text;
  return typeof text === "string" ? text.trim() : "";
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}
