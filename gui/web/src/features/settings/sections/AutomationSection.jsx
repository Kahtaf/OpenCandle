import { useEffect, useState } from "react";
import { useRuntimeTransport } from "../../../runtime/runtime-transport-context.js";
import { ReportScheduleForm } from "../../market-state/report-schedule-form.jsx";
import { SettingsBody, SettingsCard, SettingsNote, SettingsRow } from "../settings-rows.jsx";
import { useSettingsToolInvoker } from "../use-settings-tool-invoker.js";

const READ_ONLY_MESSAGE =
  "Schedule changes are unavailable while OpenCandle reconnects local access.";

export function AutomationSection({ role, setToast }) {
  const transport = useRuntimeTransport();
  const hosted = transport.kind === "hosted";
  const invokeTool = useSettingsToolInvoker();
  // An offline tab and a local follower are read-only. An online hosted
  // follower forwards mutations to the elected writer, exactly as saved
  // market state and preferences do.
  const readOnly = role === "offline" || (role !== "writer" && !hosted);
  const [saved, setSaved] = useState(false);
  const [webhook, setWebhook] = useState("unknown");

  useEffect(() => {
    if (hosted) return undefined;
    let cancelled = false;
    void transport
      .getDiagnostics({})
      .then((report) => {
        if (cancelled) return;
        setWebhook(report?.metadata?.notificationWebhookConfigured ? "configured" : "unset");
      })
      .catch(() => {
        if (!cancelled) setWebhook("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, [hosted, transport]);

  const configureSchedule = async (toolName, args) => {
    if (readOnly) {
      setToast?.(READ_ONLY_MESSAGE, { destructive: true });
      return false;
    }
    setSaved(false);
    try {
      await invokeTool(toolName, args);
      setSaved(true);
      return true;
    } catch (error) {
      setToast?.(error instanceof Error ? error.message : String(error), {
        destructive: true,
        title: "Schedule not saved",
      });
      return false;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SettingsCard
        title="Daily report"
        description={
          hosted
            ? "The morning watchlist report."
            : "The morning watchlist report and the time it runs at."
        }
      >
        <SettingsBody>
          <ReportScheduleForm
            disabled={readOnly}
            invokeTool={configureSchedule}
            onSaved={() => setSaved(true)}
          />
          {saved ? (
            <p className="m-0 mt-3 text-xs text-muted-foreground" role="status">
              Schedule saved.
            </p>
          ) : null}
          {readOnly ? (
            <p className="m-0 mt-3 text-xs text-muted-foreground">{READ_ONLY_MESSAGE}</p>
          ) : null}
        </SettingsBody>
      </SettingsCard>

      <SettingsCard title="Delivery">
        {hosted ? null : (
          <SettingsRow
            label="Webhook delivery"
            description={webhookDescription(webhook)}
            control={
              <span className="text-xs text-muted-foreground">{webhookStatusLabel(webhook)}</span>
            }
          />
        )}
        <SettingsRow
          label="In app notifications"
          description="Alert firings and finished reports are always recorded in OpenCandle first."
          control={<span className="text-xs text-muted-foreground">Always on</span>}
        />
      </SettingsCard>

      <SettingsNote>
        {hosted
          ? "Alert checks and reports run when you ask for them, with a manual check or by running a report. Nothing runs in the background or after you close the tab."
          : "Alert checks and the daily report run while OpenCandle is open. Run opencandle monitor to keep them running without the app in front of you."}
      </SettingsNote>
    </div>
  );
}

function webhookStatusLabel(state) {
  if (state === "configured") return "Configured";
  if (state === "unset") return "Not configured";
  return "Not checked yet";
}

function webhookDescription(state) {
  if (state === "configured") {
    return "Delivery attempts go to the URL in OPENCANDLE_NOTIFICATION_WEBHOOK_URL. This value is read from the environment OpenCandle starts in.";
  }
  return "Set OPENCANDLE_NOTIFICATION_WEBHOOK_URL in the environment OpenCandle starts in to post notifications to your own endpoint.";
}
