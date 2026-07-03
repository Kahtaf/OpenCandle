import { wrapProvider } from "../providers/wrap-provider.js";
import { getQuote } from "../providers/yahoo-finance.js";
import { isZeroFilledQuote } from "./resolve.js";
import type { MarketStateService, ReportRunRecord, ReportTemplateRecord } from "./service.js";

export interface DailyWatchlistReportSummary {
  watchlistId: number;
  symbols: string[];
  quoteCount: number;
  dataGapCount: number;
}

export interface DailyWatchlistReport {
  generatedAt: string;
  text: string;
  summary: DailyWatchlistReportSummary;
  dataGaps: string[];
}

// Returns the configured default-watchlist morning template if one exists.
// Manual report runs must never create a schedule template as a side effect;
// only the explicit configure flow stores schedule intent.
export function findDefaultWatchlistReportTemplate(
  service: MarketStateService,
): ReportTemplateRecord | undefined {
  return service
    .listReportTemplates()
    .find(
      (template) =>
        template.reportType === "watchlist_daily" && targetsDefaultWatchlist(template.configJson),
    );
}

export async function recordDailyWatchlistReportRun(
  service: MarketStateService,
  params: {
    templateId?: number | null;
    triggerType: "manual" | "scheduled";
    scheduledFor?: string | null;
    ownerId?: string | null;
  },
): Promise<{ report: DailyWatchlistReport; run: ReportRunRecord }> {
  const report = await generateDailyWatchlistReport(service);
  const run = service.recordReportRun({
    templateId: params.templateId,
    startedAt: report.generatedAt,
    completedAt: new Date().toISOString(),
    status: "completed",
    triggerType: params.triggerType,
    scheduledFor: params.scheduledFor,
    ownerId: params.ownerId,
    summary: { ...report.summary, text: report.text },
    errors: report.dataGaps,
  });
  service.recordNotificationEvent({
    sourceType: "report_run",
    sourceId: run.id,
    severity: report.dataGaps.length > 0 ? "warning" : "info",
    title: "Daily watchlist report generated",
    body: `Generated ${report.summary.quoteCount} quote(s) with ${report.dataGaps.length} data gap(s).`,
    payload: report.summary,
    createdAt: run.completedAt ?? report.generatedAt,
  });
  return { report, run };
}

export async function generateDailyWatchlistReport(
  service: MarketStateService,
): Promise<DailyWatchlistReport> {
  const generatedAt = new Date().toISOString();
  const watchlist = service.getDefaultWatchlist();
  const items = service.listWatchlistItems(watchlist.id);
  const dataGaps: string[] = [];

  const quotes = await Promise.all(
    items.map(async (item) => {
      const result = await wrapProvider("yahoo", () => getQuote(item.symbol));
      if (result.status === "unavailable") {
        dataGaps.push(`${item.symbol}: ${result.reason}`);
        return null;
      }
      if (result.stale) {
        dataGaps.push(`${item.symbol}: provider returned stale market data`);
        return null;
      }
      if (isZeroFilledQuote(result.data)) {
        dataGaps.push(`${item.symbol}: Yahoo returned no valid market data.`);
        return null;
      }
      return { item, quote: result.data };
    }),
  );

  const validQuotes = quotes.filter((q) => q != null);
  const movers = [...validQuotes].sort(
    (a, b) => Math.abs(b.quote.changePercent) - Math.abs(a.quote.changePercent),
  );
  const freshnessLines =
    validQuotes.length === 0 ? [`  No quote data available.`] : quoteFreshnessLines(validQuotes);
  const moverLines =
    movers.length === 0
      ? [`  No movers available.`]
      : movers
          .slice(0, 5)
          .map(
            ({ item, quote }) =>
              `  ${item.symbol}: ${formatSigned(quote.changePercent)}% to $${quote.price.toFixed(2)}`,
          );
  const dataGapLines = dataGaps.length === 0 ? [`  None.`] : dataGaps.map((gap) => `  ${gap}`);

  const lines = [
    `**Daily Watchlist Report**`,
    `Generated: ${generatedAt}`,
    `Target watchlist: ${watchlist.name}`,
    ``,
    `Quote freshness`,
    ...freshnessLines,
    ``,
    `Major movers`,
    ...moverLines,
    ``,
    `Recent alerts`,
    `  ${service.listAlertEvents().length} recorded alert event(s).`,
    ``,
    `Data gaps`,
    ...dataGapLines,
  ];

  return {
    generatedAt,
    text: lines.join("\n"),
    summary: {
      watchlistId: watchlist.id,
      symbols: items.map((item) => item.symbol),
      quoteCount: validQuotes.length,
      dataGapCount: dataGaps.length,
    },
    dataGaps,
  };
}

export function nextDailyReportRunAt(
  timezone: string,
  localTime: string,
  now = new Date(),
): string {
  const [hourPart, minutePart] = localTime.split(":");
  const hour = Number(hourPart);
  const minute = Number(minutePart);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(`Invalid report local_time: ${localTime}`);
  }

  const today = zonedDateParts(now, timezone);
  let candidate = zonedTimeToUtc(today, hour, minute, timezone);
  if (candidate.getTime() <= now.getTime()) {
    const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1, 12, 0, 0));
    candidate = zonedTimeToUtc(zonedDateParts(tomorrow, timezone), hour, minute, timezone);
  }
  return candidate.toISOString();
}

export function targetsDefaultWatchlist(config: unknown): boolean {
  if (typeof config !== "object" || config === null) return false;
  const targets = (config as { targets?: unknown }).targets;
  if (typeof targets !== "object" || targets === null) return false;
  return (targets as { default_watchlist?: unknown }).default_watchlist === true;
}

function quoteFreshnessLines(
  quotes: Array<{ item: { symbol: string }; quote: { timestamp: number; price: number } }>,
): string[] {
  return quotes.map(
    ({ item, quote }) =>
      `  ${item.symbol}: $${quote.price.toFixed(2)} as of ${new Date(quote.timestamp).toISOString()}`,
  );
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function zonedDateParts(
  date: Date,
  timezone: string,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return {
    year: numberPart(parts, "year"),
    month: numberPart(parts, "month"),
    day: numberPart(parts, "day"),
  };
}

function zonedTimeToUtc(
  date: { year: number; month: number; day: number },
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const naiveUtc = new Date(Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0));
  const offsetMs = timeZoneOffsetMs(naiveUtc, timezone);
  return new Date(naiveUtc.getTime() - offsetMs);
}

function timeZoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(date);
  const value = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?$/.exec(value);
  if (!match?.groups) return 0;
  const sign = match.groups.sign === "-" ? -1 : 1;
  const hours = Number(match.groups.hours);
  const minutes = Number(match.groups.minutes ?? "0");
  return sign * ((hours * 60 + minutes) * 60_000);
}

function numberPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (value == null) throw new Error(`Missing ${type} in formatted date`);
  return Number(value);
}
