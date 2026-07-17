import { AlertTriangle, Bell, CirclePause, ShieldCheck } from "lucide-react";
import { buildAlertSentenceRows } from "../market-state/alert-view-model.js";
import { Panel } from "../market-state/shared.jsx";

const HEADING_ID = "home-alerts-heading";
const EMPTY_ITEMS = [];
const LINK_CLASS =
  "inline-flex min-h-10 items-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-[color,transform,scale] duration-150 ease-out hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AlertsCard({
  alerts = EMPTY_ITEMS,
  alertEvents = EMPTY_ITEMS,
  notifications = EMPTY_ITEMS,
  instruments = EMPTY_ITEMS,
  nowMs = Date.now(),
}) {
  const rows = buildAlertSentenceRows(alerts, alertEvents, instruments, nowMs).slice(0, 3);
  const actions =
    rows.length > 0 || notifications.length > 0 ? (
      <a href="/alerts" className={LINK_CLASS}>
        View all
      </a>
    ) : null;

  return (
    <section aria-labelledby={HEADING_ID} data-slot="home-alerts-card">
      <Panel title={<span id={HEADING_ID}>Alerts</span>} actions={actions}>
        {rows.length === 0 && notifications.length === 0 ? (
          <div className="flex min-h-[168px] flex-col items-start justify-center gap-2 px-4 py-6">
            <div className="text-sm font-medium text-foreground">No alerts configured</div>
            <p className="m-0 text-xs leading-5 text-muted-foreground">
              Create an alert to monitor a price or market condition.
            </p>
            <a href="/alerts" className={LINK_CLASS}>
              Create an alert
            </a>
          </div>
        ) : (
          <div className="min-h-[168px]">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex min-h-14 items-start gap-3 border-b border-border/70 px-4 py-3"
              >
                <AlertStateIcon tone={row.tone} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium tabular-nums text-foreground">
                    {row.symbol} · {row.sentence}
                  </div>
                  <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                    {row.detail}
                  </div>
                </div>
              </div>
            ))}
            {notifications.slice(0, Math.max(1, 3 - rows.length)).map((notification) => (
              <div
                key={notification.id}
                className="flex min-h-14 items-center gap-3 border-b border-border/70 px-4 py-3 last:border-0"
              >
                <Bell className="size-4 shrink-0 text-info" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-foreground">
                    {notification.title || "Alert notification"}
                  </div>
                  <div className="text-xs text-muted-foreground">Notification</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </section>
  );
}

function AlertStateIcon({ tone }) {
  if (tone === "degraded") {
    return <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Degraded" />;
  }
  if (tone === "paused") {
    return (
      <CirclePause className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Paused" />
    );
  }
  return <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-label="Armed" />;
}
