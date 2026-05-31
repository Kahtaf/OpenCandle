import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getQuote } from "../../providers/yahoo-finance.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { initDefaultDatabase } from "../../memory/sqlite.js";
import { MarketStateService } from "../../market-state/service.js";

const params = Type.Object({
  action: Type.Union(
    [Type.Literal("run"), Type.Literal("configure"), Type.Literal("history")],
    { description: "Run the daily watchlist report, configure its schedule metadata, or show history" },
  ),
  timezone: Type.Optional(
    Type.String({ description: "IANA timezone for future scheduled morning reports" }),
  ),
  local_time: Type.Optional(
    Type.String({ description: "Local time for future scheduled morning reports, HH:MM" }),
  ),
});

export const dailyReportTool: AgentTool<typeof params> = {
  name: "daily_watchlist_report",
  label: "Daily Report",
  description:
    "Generate or configure the V1 daily watchlist report. Reports run manually in V1 and preserve schedule metadata for future heartbeat execution.",
  parameters: params,
  async execute(_toolCallId, args) {
    const db = initDefaultDatabase();
    const service = new MarketStateService(db);

    try {
      if (args.action === "configure") {
        const template = service.createReportTemplate({
          name: "Morning watchlist",
          reportType: "watchlist_daily",
          cadence: "daily",
          timezone: args.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          localTime: args.local_time ?? "08:00",
          config: { targets: { default_watchlist: true } },
          enabled: true,
        });
        return {
          content: [{
            type: "text",
            text: `Configured daily watchlist report for ${template.localTime} ${template.timezone}.`,
          }],
          details: template,
        };
      }

      if (args.action === "history") {
        const runs = service.listReportRuns();
        if (runs.length === 0) {
          return { content: [{ type: "text", text: "No daily report runs yet." }], details: [] };
        }
        const lines = ["**Daily Report History**", ""];
        for (const run of runs.slice(0, 10)) {
          lines.push(`  ${run.startedAt}: ${run.status}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }], details: runs };
      }

      const report = await generateDailyReport(service);
      const run = service.recordReportRun({
        startedAt: report.generatedAt,
        completedAt: new Date().toISOString(),
        status: "completed",
        summary: report.summary,
        errors: report.dataGaps,
      });
      return {
        content: [{ type: "text", text: report.text }],
        details: run,
      };
    } finally {
      db.close();
    }
  },
};

async function generateDailyReport(service: MarketStateService): Promise<{
  generatedAt: string;
  text: string;
  summary: unknown;
  dataGaps: string[];
}> {
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
      return { item, quote: result.data };
    }),
  );

  const validQuotes = quotes.filter((q) => q != null);
  const movers = [...validQuotes].sort(
    (a, b) => Math.abs(b.quote.changePercent) - Math.abs(a.quote.changePercent),
  );
  const freshnessLines = validQuotes.length === 0
    ? [`  No quote data available.`]
    : quoteFreshnessLines(validQuotes);
  const moverLines = movers.length === 0
    ? [`  No movers available.`]
    : movers.slice(0, 5).map(({ item, quote }) =>
        `  ${item.symbol}: ${formatSigned(quote.changePercent)}% to $${quote.price.toFixed(2)}`,
      );
  const dataGapLines = dataGaps.length === 0
    ? [`  None.`]
    : dataGaps.map((gap) => `  ${gap}`);

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
    `Technical snapshot`,
    `  Deferred in V1 report generation unless quote/history data is available through a later section builder.`,
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

function quoteFreshnessLines(
  quotes: Array<{ item: { symbol: string }; quote: { timestamp: number; price: number } }>,
): string[] {
  return quotes.map(({ item, quote }) =>
    `  ${item.symbol}: $${quote.price.toFixed(2)} as of ${new Date(quote.timestamp).toISOString()}`,
  );
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}
