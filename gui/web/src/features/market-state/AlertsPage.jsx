import { Bell, CirclePause, CirclePlay, Pencil, Trash2 } from "lucide-react";
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
          state.alerts.length > 3 ? (
            <PanelSearch label="Search alerts" filter={filter} setFilter={setFilter} />
          ) : null
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
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-border/70 px-4 py-3 last:border-0 sm:grid-cols-[auto_3.5rem_minmax(0,1fr)_auto_auto]"
              >
                <div className="col-start-1 row-start-1">
                  <StatusDot tone={row.tone} label="" />
                </div>
                <span className="col-start-2 row-start-1 text-[13px] font-semibold text-foreground sm:w-14">
                  {row.symbol}
                </span>
                <div className="col-span-3 row-start-2 min-w-0 sm:col-span-1 sm:col-start-3 sm:row-start-1">
                  <div className="text-[13px] text-foreground">{row.sentence}</div>
                  <div className="text-xs text-muted-foreground">{row.detail}</div>
                </div>
                {row.tone === "degraded" ? (
                  <Badge
                    tone="warn"
                    className="col-start-3 row-start-1 justify-self-end sm:col-start-4"
                  >
                    Data unavailable
                  </Badge>
                ) : (
                  <Badge className="col-start-3 row-start-1 justify-self-end sm:col-start-4">
                    {sentenceCase(row.retriggerMode)}
                  </Badge>
                )}
                <div
                  className="col-span-3 row-start-3 flex justify-end gap-1 sm:col-span-1 sm:col-start-5 sm:row-start-1"
                  data-slot="alert-row-actions"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    icon={row.enabled ? CirclePause : CirclePlay}
                    aria-label={`${row.enabled ? "Pause" : "Resume"} ${row.symbol} alert`}
                    className="min-h-10 min-w-10"
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
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    icon={Pencil}
                    aria-label={`Edit ${row.symbol} alert`}
                    className="min-h-10 min-w-10"
                    disabled={readOnly}
                    onClick={() => openPanel("alert-edit", { alert: row.rule, symbol: row.symbol })}
                  />
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Delete alert"
                    icon={Trash2}
                    ariaLabel={`Delete ${row.symbol} alert`}
                    className="min-h-10 min-w-10 text-destructive hover:text-destructive"
                    disabled={readOnly}
                    onConfirm={() => invokeTool("manage_alerts", { action: "delete", id: row.id })}
                  />
                </div>
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
                  {event.status === "unavailable" ? <Badge tone="warn">Unavailable</Badge> : null}
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
            className="border-b border-border/70 px-4 py-2.5 text-[13px] last:border-0"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0 flex-1" data-slot="notification-message">
                <span className="block truncate text-foreground" title={notification.title}>
                  {notification.title}
                </span>
                {notification.severity === "warning" ? <Badge tone="warn">Warning</Badge> : null}
              </div>
              <span
                className="shrink-0 text-xs text-muted-foreground"
                data-slot="notification-channel"
              >
                {deliveryStatus(attempts, notification.id)}
              </span>
            </div>
            <div className="mt-1 flex min-h-10 items-center justify-between gap-3">
              <time className="shrink-0 tabular-nums text-xs text-muted-foreground">
                {relativeTime(notification.createdAt) || "—"}
              </time>
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
            </div>
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

function sentenceCase(value) {
  const label = String(value ?? "").trim();
  return label ? `${label[0].toUpperCase()}${label.slice(1).toLowerCase()}` : "";
}
