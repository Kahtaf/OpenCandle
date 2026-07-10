import { Bell } from "lucide-react";
import { useMemo } from "react";
import { Button } from "../../components/ui/button.jsx";
import { buildAlertSentenceRows } from "./alert-view-model.js";
import { relativeTime } from "./format.js";
import {
  Badge,
  ConfirmButton,
  EmptyState,
  filterItems,
  groupByOne,
  Panel,
  PanelSearch,
  RowActions,
  StatusDot,
} from "./shared.jsx";

export function AlertsPage({ state, filter, setFilter, readOnly, openPanel, invokeTool }) {
  const sentenceRows = useMemo(
    () => buildAlertSentenceRows(state.alerts, state.alertEvents, state.instruments),
    [state.alerts, state.alertEvents, state.instruments],
  );
  const rows = useMemo(
    () => filterItems(sentenceRows, filter, ["symbol", "sentence", "detail"]),
    [sentenceRows, filter],
  );
  const instrumentsById = useMemo(() => groupByOne(state.instruments, "id"), [state.instruments]);
  const lastRun = state.alertCheckRuns?.[0] ?? null;
  const runnerActive = Boolean(state.runnerLease);

  const monitoringMeta = [
    runnerActive ? "Monitoring locally" : "Manual checks only",
    lastRun ? `last check ${relativeTime(lastRun.startedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="Active rules"
        count={rows.length}
        meta={monitoringMeta}
        actions={
          <>
            {state.alerts.length > 0 ? (
              <Button
                type="button"
                variant="bordered"
                size="sm"
                disabled={readOnly}
                onClick={() => openPanel("alert-create")}
              >
                Create alert
              </Button>
            ) : null}
            {state.alerts.length > 3 ? (
              <PanelSearch label="Search alerts" filter={filter} setFilter={setFilter} />
            ) : null}
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={state.alerts.length === 0 ? "No alerts yet" : "No alerts match this search"}
            action="Create an alert from a watchlist symbol, or set one up here. Rules are checked while OpenCandle is open."
            cta={{
              label: "Create alert",
              disabled: readOnly,
              onClick: () => openPanel("alert-create"),
            }}
          />
        ) : (
          <ul>
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-3 last:border-0"
              >
                <StatusDot tone={row.tone} label="" />
                <span className="w-14 shrink-0 text-[13px] font-semibold text-foreground">
                  {row.symbol}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-foreground">{row.sentence}</div>
                  <div className="text-xs text-muted-foreground">{row.detail}</div>
                </div>
                {row.tone === "degraded" ? (
                  <Badge tone="warn">data unavailable</Badge>
                ) : (
                  <Badge>{row.retriggerMode}</Badge>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  role="switch"
                  aria-checked={row.enabled}
                  disabled={readOnly}
                  onClick={() =>
                    invokeTool("manage_alerts", {
                      action: "set_enabled",
                      id: row.id,
                      enabled: !row.enabled,
                    })
                  }
                >
                  {row.enabled ? "Pause" : "Resume"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={readOnly}
                  onClick={() => openPanel("alert-edit", { alert: row.rule, symbol: row.symbol })}
                >
                  Edit
                </Button>
                <ConfirmButton
                  label="Delete"
                  confirmLabel="Delete alert"
                  disabled={readOnly}
                  onConfirm={() => invokeTool("manage_alerts", { action: "delete", id: row.id })}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Alert log" count={state.alertEvents.length}>
        {state.alertEvents.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="Nothing logged yet"
            action="Alert firings, unavailable checks, and report runs appear here as they happen."
          />
        ) : (
          <ul>
            {state.alertEvents.slice(0, 15).map((event) => (
              <li
                key={event.id ?? `${event.alertRuleId}:${event.observedAt || event.triggeredAt}`}
                className="grid grid-cols-[90px_minmax(0,1fr)] gap-3 border-b border-border/70 px-4 py-2.5 text-[13px] last:border-0 sm:grid-cols-[110px_minmax(0,1fr)]"
              >
                <time className="tabular-nums text-muted-foreground">
                  {relativeTime(event.observedAt || event.triggeredAt) || "—"}
                </time>
                <div className="min-w-0">
                  <span className="font-semibold">
                    {instrumentsById.get(event.instrumentId)?.symbol ?? ""}
                  </span>{" "}
                  {event.message || event.status}
                  {event.status === "unavailable" ? <Badge tone="warn">unavailable</Badge> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <NotificationsPanel
        notifications={state.notifications}
        attempts={state.notificationDeliveryAttempts}
        readOnly={readOnly}
        invokeTool={invokeTool}
      />
    </div>
  );
}

export function NotificationsPanel({
  notifications,
  attempts,
  readOnly,
  invokeTool,
  title = "Notifications",
}) {
  const unread = notifications.filter((notification) => notification.status !== "acknowledged");
  if (notifications.length === 0) return null;
  return (
    <Panel title={title} count={unread.length || undefined}>
      <ul>
        {notifications.slice(0, 10).map((notification) => (
          <li
            key={notification.id}
            className="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-2.5 text-[13px] last:border-0"
          >
            <time className="w-[90px] shrink-0 tabular-nums text-muted-foreground sm:w-[110px]">
              {relativeTime(notification.createdAt) || "—"}
            </time>
            <div className="min-w-0 flex-1">
              <span className="text-foreground">{notification.title}</span>
              {notification.severity === "warning" ? <Badge tone="warn">warning</Badge> : null}
            </div>
            <span className="text-xs text-muted-foreground">
              {deliveryStatus(attempts, notification.id)}
            </span>
            <RowActions
              disabled={readOnly || notification.status === "acknowledged"}
              actions={[
                [
                  "Mark read",
                  () =>
                    invokeTool("manage_notifications", {
                      action: "acknowledge",
                      id: notification.id,
                    }),
                ],
              ]}
            />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function deliveryStatus(attempts = [], notificationId) {
  const matching = attempts.filter((attempt) => attempt.notificationEventId === notificationId);
  if (matching.length === 0) return "in-app";
  return matching[0].status;
}
