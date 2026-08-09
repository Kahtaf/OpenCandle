import { FileText } from "lucide-react";
import { Button } from "../../components/ui/button.jsx";
import { useRuntimeTransport } from "../../runtime/runtime-transport-context.js";
import { NotificationsPanel } from "./AlertsPage.jsx";
import { formatHumanDateTime, shortDateLabel } from "./format.js";
import { humanizeReportMarkdown, reportRunTitle, reportStatusLabel } from "./report-format.js";
import { ReportRichText } from "./report-rich-text.jsx";
import { Badge, EmptyState, Panel } from "./shared.jsx";

export function ReportsPage({ state, readOnly, invokeTool, timeZone }) {
  const template =
    state.reportTemplates.find((candidate) => candidate.enabled) ??
    state.reportTemplates[0] ??
    null;
  const latestRun = state.reportRuns.find((run) => run.status === "completed") ?? null;
  const rawReportText =
    typeof latestRun?.summaryJson?.text === "string" ? latestRun.summaryJson.text : null;
  const reportText = rawReportText ? humanizeReportMarkdown(rawReportText, timeZone) : null;
  const reportNotifications = state.notifications.filter(
    (notification) => notification.sourceType === "report_run",
  );

  // The web app has no scheduler, so a stored template time would read as a
  // promise nothing keeps; state the on-demand behavior instead.
  const hosted = useRuntimeTransport().kind === "hosted";
  const scheduleMeta = hosted
    ? "Reports run when you ask for one"
    : template
      ? `Daily at ${template.localTime} (${template.timezone})${template.nextRunAt ? ` · next run ${shortDateLabel(template.nextRunAt)}` : ""}`
      : "No schedule configured";

  return (
    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Panel
        title="Morning report"
        meta={scheduleMeta}
        actions={
          reportText ? (
            <Button
              type="button"
              variant="bordered"
              size="sm"
              disabled={readOnly}
              onClick={() => invokeTool("daily_watchlist_report", { action: "run" })}
            >
              Generate today
            </Button>
          ) : null
        }
      >
        {reportText ? (
          <article className="max-w-[720px] px-5 py-4">
            <p className="text-xs text-muted-foreground">
              Generated{" "}
              {formatHumanDateTime(latestRun.completedAt || latestRun.startedAt, timeZone) ||
                shortDateLabel(latestRun.startedAt)}
              {latestRun.triggerType === "scheduled" ? " · scheduled" : " · manual"}
            </p>
            <div className="mt-3">
              <ReportRichText>{reportText}</ReportRichText>
            </div>
          </article>
        ) : (
          <EmptyState
            icon={FileText}
            title="No report yet"
            action="Generate today's watchlist report to see movers, levels approaching, and data gaps in one place."
            cta={{
              label: "Generate today",
              disabled: readOnly,
              onClick: () => invokeTool("daily_watchlist_report", { action: "run" }),
            }}
          />
        )}
      </Panel>

      <div className="flex flex-col gap-3">
        <Panel title="History" count={state.reportRuns.length}>
          {state.reportRuns.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">Past report runs appear here.</p>
          ) : (
            <ul>
              {state.reportRuns.slice(0, 10).map((run) => (
                <li
                  key={run.id ?? run.startedAt}
                  className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5 text-[13px] last:border-0"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      {reportRunTitle(run)}
                    </div>
                    <div className="truncate text-xs tabular-nums text-muted-foreground">
                      {formatHumanDateTime(run.startedAt, timeZone) || "—"} · {run.triggerType}
                      {Array.isArray(run.errorsJson) && run.errorsJson.length
                        ? ` · ${run.errorsJson.length} data gap${run.errorsJson.length === 1 ? "" : "s"}`
                        : ""}
                    </div>
                  </div>
                  <Badge tone={run.status === "completed" ? "ok" : "warn"}>
                    {reportStatusLabel(run.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <NotificationsPanel
          title="Report notifications"
          notifications={reportNotifications}
          attempts={state.notificationDeliveryAttempts}
          readOnly={readOnly}
          invokeTool={invokeTool}
        />
      </div>
    </div>
  );
}
