import { FileText } from "lucide-react";
import { Button } from "../../components/ui/button.jsx";
import { NotificationsPanel } from "./AlertsPage.jsx";
import { relativeTime, shortDateLabel } from "./format.js";
import { Badge, EmptyState, Panel } from "./shared.jsx";

export function ReportsPage({ state, readOnly, invokeTool }) {
  const template =
    state.reportTemplates.find((candidate) => candidate.enabled) ??
    state.reportTemplates[0] ??
    null;
  const latestRun = state.reportRuns.find((run) => run.status === "completed") ?? null;
  const reportText =
    typeof latestRun?.summaryJson?.text === "string" ? latestRun.summaryJson.text : null;
  const reportNotifications = state.notifications.filter(
    (notification) => notification.sourceType === "report_run",
  );

  const scheduleMeta = template
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
              {relativeTime(latestRun.completedAt || latestRun.startedAt) ||
                shortDateLabel(latestRun.startedAt)}
              {latestRun.triggerType === "scheduled" ? " · scheduled" : " · manual"}
            </p>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-[13px] leading-6 text-foreground">
              {reportText}
            </pre>
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
                  <div>
                    <div className="font-medium text-foreground">
                      {shortDateLabel(run.startedAt) || "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {run.triggerType}
                      {Array.isArray(run.errorsJson) && run.errorsJson.length
                        ? ` · ${run.errorsJson.length} data gap${run.errorsJson.length === 1 ? "" : "s"}`
                        : ""}
                    </div>
                  </div>
                  {run.status === "completed" ? (
                    <Badge tone="ok">done</Badge>
                  ) : (
                    <Badge tone="warn">{run.status}</Badge>
                  )}
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
