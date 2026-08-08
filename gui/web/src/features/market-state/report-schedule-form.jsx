import { useId, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { useRuntimeTransport } from "../../runtime/runtime-transport-context.js";

// One schedule form for both callers: the Reports slide-over and the
// Notifications & automation settings section. Both dispatch the same
// `daily_watchlist_report` configure action.
export function ReportScheduleForm({ disabled, invokeTool, onSaved }) {
  const reportTimeId = useId();
  const [localTime, setLocalTime] = useState("08:00");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // The hosted runtime has no scheduler, and hosted state does not sync to a
  // local install, so the web app offers no schedule controls at all: saving
  // a time there would persist a value nothing ever consumes.
  const hosted = useRuntimeTransport().kind === "hosted";

  if (hosted) {
    return (
      <p data-slot="report-schedule-form" className="text-sm text-muted-foreground">
        In the web app, reports run when you ask for one. Nothing runs on a schedule or after you
        close the tab.
      </p>
    );
  }

  return (
    <form
      data-slot="report-schedule-form"
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const saved = await invokeTool("daily_watchlist_report", {
          action: "configure",
          timezone,
          local_time: localTime,
        });
        if (saved) onSaved?.();
      }}
    >
      <p className="text-sm text-muted-foreground">
        The morning report runs daily while OpenCandle is open. Times use your timezone ({timezone}
        ).
      </p>
      <label
        htmlFor={reportTimeId}
        className="grid gap-1 text-xs font-medium text-muted-foreground"
      >
        Run at
        <Input
          id={reportTimeId}
          type="time"
          value={localTime}
          disabled={disabled}
          required
          onChange={(event) => setLocalTime(event.target.value)}
        />
      </label>
      <Button type="submit" variant="brand" size="sm" disabled={disabled || !localTime}>
        Save schedule
      </Button>
    </form>
  );
}
