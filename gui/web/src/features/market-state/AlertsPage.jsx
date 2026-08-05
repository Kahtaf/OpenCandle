import { Bell, Check, ChevronDown, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import { cn } from "../../lib/utils.js";
import { buildActivityRows, buildAlertSentenceRows } from "./alert-view-model.js";
import { relativeTime, shortDateLabel } from "./format.js";
import { Badge, EmptyState, filterItems, Panel, PanelSearch, StatusDot } from "./shared.jsx";

// Icon actions rest invisible on pointer surfaces and appear for the hovered or
// focused row. Touch surfaces keep them visible at full 40px targets.
const HOVER_ACTIONS_CLASS =
  "transition-opacity duration-150 ease-out motion-reduce:transition-none md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100";
const ROW_ICON_CLASS = "size-10 min-h-10 min-w-10 md:size-8 md:min-h-8 md:min-w-8";

export function AlertsPage({ state, filter, setFilter, readOnly, openPanel, invokeTool }) {
  const sentenceRows = useMemo(
    () => buildAlertSentenceRows(state.alerts, state.alertEvents, state.instruments),
    [state.alerts, state.alertEvents, state.instruments],
  );
  const rows = useMemo(
    () => filterItems(sentenceRows, filter, ["symbol", "sentence", "status", "explanation"]),
    [sentenceRows, filter],
  );
  const activityRows = useMemo(
    () =>
      buildActivityRows({
        alertEvents: state.alertEvents,
        notifications: state.notifications,
        deliveryAttempts: state.notificationDeliveryAttempts,
        instruments: state.instruments,
      }),
    [state.alertEvents, state.notifications, state.notificationDeliveryAttempts, state.instruments],
  );
  const [pendingDelete, setPendingDelete] = useState(null);
  const lastRun = state.alertCheckRuns?.[0] ?? null;
  const runnerActive = Boolean(state.runnerLease);

  const monitoringMeta = [
    runnerActive ? "Monitoring locally" : "Manual checks only",
    lastRun ? `last check ${relativeTime(lastRun.startedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    // Both panels take the full width: an activity row is one line of title,
    // state and date, and a narrow rail would truncate the title to fit them.
    <div className="flex flex-col gap-3">
      <Panel
        title="Active rules"
        headingClassName="whitespace-nowrap"
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
              <AlertRuleRow
                key={row.id}
                row={row}
                readOnly={readOnly}
                openPanel={openPanel}
                invokeTool={invokeTool}
                onDelete={() => setPendingDelete(row)}
              />
            ))}
          </ul>
        )}
      </Panel>

      {state.alerts.length > 0 || activityRows.length > 0 ? (
        <Panel title="Activity" count={activityRows.length}>
          {activityRows.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              Alert firings and unavailable checks appear here.
            </p>
          ) : (
            <ActivityFeed rows={activityRows} readOnly={readOnly} invokeTool={invokeTool} />
          )}
        </Panel>
      ) : null}

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {pendingDelete?.symbol} alert?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.sentence} will no longer be checked. Watchlists and holdings are
              unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                invokeTool("manage_alerts", { action: "delete", id: pendingDelete.id });
                setPendingDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AlertRuleRow({ row, readOnly, openPanel, invokeTool, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li
      data-slot="alert-rule-row"
      className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-b border-border/70 px-4 py-3 last:border-0 sm:grid-cols-[auto_3.75rem_minmax(0,1fr)_auto]"
    >
      <span className="col-start-1 row-start-1 pt-1.5">
        <StatusDot tone={row.tone} label="" />
      </span>
      {/* Narrow rows read as one sentence under the ticker; from sm the ticker
          takes its own column so the rules line up as a table. */}
      <span className="col-start-2 row-start-1 hidden text-[13px] font-semibold text-foreground sm:block">
        {row.symbol}
      </span>
      <div className="col-start-2 row-start-1 min-w-0 sm:col-start-3">
        <div className="text-[13px] text-foreground">
          <span className="font-semibold sm:hidden">{row.symbol} </span>
          {row.sentence}
        </div>
        {row.explanation ? (
          // The negative margins keep a 40px tap area around a status line that
          // only takes the height of its own text.
          <div className="mt-0.5">
            <button
              type="button"
              data-slot="alert-status-disclosure"
              aria-expanded={expanded}
              className="-mx-1 -my-3 inline-flex items-center gap-1 rounded-sm px-1 py-3 text-xs text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setExpanded((open) => !open)}
            >
              {row.status}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-3 transition-transform duration-150 ease-out motion-reduce:transition-none",
                  expanded && "rotate-180",
                )}
              />
            </button>
          </div>
        ) : (
          <div className="mt-0.5 text-xs text-muted-foreground">{row.status}</div>
        )}
        {expanded && row.explanation ? (
          <p
            data-slot="alert-status-detail"
            className="mt-1 text-xs leading-5 text-muted-foreground"
          >
            {row.explanation}
          </p>
        ) : null}
      </div>
      <div className="col-start-3 row-start-1 flex items-center justify-self-end sm:col-start-4">
        {/* Narrow rows carry state in the dot and the status line instead,
            so the rule sentence keeps the width it needs. */}
        {row.tone === "degraded" ? (
          <Badge tone="warn" className="hidden sm:inline-flex">
            Data unavailable
          </Badge>
        ) : (
          <Badge className="hidden sm:inline-flex">{row.enabled ? row.cadence : "Paused"}</Badge>
        )}
        <div className={cn("ml-1 flex items-center", HOVER_ACTIONS_CLASS)}>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            icon={row.enabled ? Pause : Play}
            aria-label={`${row.enabled ? "Pause" : "Resume"} ${row.symbol} alert`}
            className={ROW_ICON_CLASS}
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
            size="icon-xs"
            icon={Pencil}
            aria-label={`Edit ${row.symbol} alert`}
            className={ROW_ICON_CLASS}
            disabled={readOnly}
            onClick={() => openPanel("alert-edit", { alert: row.rule, symbol: row.symbol })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            icon={Trash2}
            aria-label={`Delete ${row.symbol} alert`}
            className={cn(ROW_ICON_CLASS, "text-muted-foreground hover:text-destructive")}
            disabled={readOnly}
            onClick={onDelete}
          />
        </div>
      </div>
    </li>
  );
}

function ActivityFeed({ rows, readOnly, invokeTool }) {
  return (
    <ul>
      {rows.map((row) => (
        <li
          key={row.key}
          data-slot="activity-row"
          // One line from sm up. Narrow viewports give the title its own line
          // and drop the state and date underneath rather than truncating it.
          className="group flex min-h-11 flex-wrap items-center gap-x-2 border-b border-border/70 px-4 py-1.5 text-[13px] last:border-0 sm:flex-nowrap"
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              row.unread ? "bg-foreground" : "bg-transparent",
            )}
          />
          <span
            data-slot="notification-message"
            className="min-w-0 flex-1 basis-[calc(100%-1.5rem)] truncate text-foreground sm:basis-auto"
            title={row.title}
          >
            {row.title}
          </span>
          {row.badge ? (
            // Aligns under the title, not the unread dot, once the row wraps.
            <Badge tone="warn" className="ml-3.5 sm:ml-0">
              {row.badge}
            </Badge>
          ) : null}
          <span className={cn("flex shrink-0 items-center", HOVER_ACTIONS_CLASS)}>
            {row.unread && row.notificationId != null ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                icon={Check}
                title="Mark read"
                aria-label={`Mark read: ${row.title}`}
                className={ROW_ICON_CLASS}
                disabled={readOnly}
                onClick={() =>
                  invokeTool("manage_notifications", {
                    action: "acknowledge",
                    id: row.notificationId,
                  })
                }
              />
            ) : null}
          </span>
          <time
            data-slot="activity-date"
            className="ml-auto shrink-0 tabular-nums text-xs text-muted-foreground sm:ml-0"
          >
            {shortDateLabel(row.at) || "—"}
          </time>
        </li>
      ))}
    </ul>
  );
}

export function NotificationsPanel({
  notifications,
  attempts,
  readOnly,
  invokeTool,
  title = "Notifications",
}) {
  const rows = useMemo(
    () => buildActivityRows({ notifications, deliveryAttempts: attempts }, 10),
    [notifications, attempts],
  );
  if (rows.length === 0) return null;
  return (
    <Panel title={title} count={rows.length}>
      <ActivityFeed rows={rows} readOnly={readOnly} invokeTool={invokeTool} />
    </Panel>
  );
}
