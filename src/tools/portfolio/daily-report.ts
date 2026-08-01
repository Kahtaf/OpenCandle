import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import {
  findDefaultWatchlistReportTemplate,
  nextDailyReportRunAt,
  recordDailyWatchlistReportRun,
  targetsDefaultWatchlist,
} from "../../market-state/daily-report.js";
import { deliverPendingNotifications } from "../../market-state/notification-delivery.js";
import { MarketStateService } from "../../market-state/service.js";
import { initDefaultDatabase } from "../../memory/sqlite.js";
import type { StatefulToolOptions } from "./stateful-tool-options.js";

const ACTION_DESCRIPTION = [
  "One of: run, configure, history.",
  "Use run to generate the daily watchlist report now.",
  "Use configure to save schedule metadata such as timezone and local_time.",
  "Use history to show prior report runs; do not use list or show_history.",
].join(" ");

const params = Type.Object({
  action: Type.Union([Type.Literal("run"), Type.Literal("configure"), Type.Literal("history")], {
    description: ACTION_DESCRIPTION,
  }),
  timezone: Type.Optional(
    Type.String({ description: "IANA timezone for future scheduled morning reports" }),
  ),
  local_time: Type.Optional(
    Type.String({ description: "Local time for future scheduled morning reports, HH:MM" }),
  ),
});

export function createDailyReportTool(options: StatefulToolOptions): AgentTool<typeof params> {
  return {
    name: "daily_watchlist_report",
    label: "Daily Report",
    description:
      "Generate, configure, or show history for the local daily watchlist report. Actions are run, configure, and history. Reports can run manually and configured schedules run while an OpenCandle writer/monitor process is active.",
    parameters: params,
    async execute(_toolCallId, args) {
      const db = options.stateDatabaseFactory();
      const service = new MarketStateService(db);

      try {
        if (args.action === "configure") {
          const templateParams = {
            name: "Morning watchlist",
            reportType: "watchlist_daily",
            cadence: "daily",
            timezone: args.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
            localTime: args.local_time ?? "08:00",
            config: { targets: { default_watchlist: true } },
            enabled: true,
          };
          const nextRunAt = nextDailyReportRunAt(templateParams.timezone, templateParams.localTime);
          const existing = service
            .listReportTemplates()
            .find(
              (template) =>
                template.reportType === "watchlist_daily" &&
                targetsDefaultWatchlist(template.configJson),
            );
          const template = existing
            ? service.updateReportTemplate(existing.id, { ...templateParams, nextRunAt })
            : service.createReportTemplate({ ...templateParams, nextRunAt });
          return {
            content: [
              {
                type: "text",
                text: `Configured daily watchlist report for ${template.localTime} ${template.timezone}.`,
              },
            ],
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

        if (args.action !== "run") {
          throw new Error(`Unsupported daily report action: ${String(args.action)}`);
        }

        // Manual runs link to the configured schedule when one exists but never
        // create a template as a side effect — generation must not imply a
        // schedule the user did not set up.
        const template = findDefaultWatchlistReportTemplate(service);
        const { report, run } = await recordDailyWatchlistReportRun(service, {
          templateId: template?.id ?? null,
          triggerType: "manual",
        });
        await deliverPendingNotifications(service);
        const text = template
          ? report.text
          : `${report.text}\n\n(Unscheduled manual run — use the configure action to set up a morning report that runs while OpenCandle is open.)`;
        return {
          content: [{ type: "text", text }],
          details: run,
        };
      } finally {
        if (options.closeDatabaseAfterExecute !== false) db.close();
      }
    },
  };
}

export const dailyReportTool = createDailyReportTool({
  stateDatabaseFactory: initDefaultDatabase,
});
