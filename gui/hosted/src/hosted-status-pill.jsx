import { useEffect, useState } from "react";
import { useWaitingServiceWorker } from "../../web/src/hooks/use-waiting-service-worker.js";
import { Badge } from "../../web/src/components/ui/badge.jsx";
import { Button } from "../../web/src/components/ui/button.jsx";
import { cn } from "../../web/src/lib/utils.js";
import { hostedStatusPillView, refreshHostedRuntimeStatus } from "./hosted-runtime-status.js";

// Quiet chrome floating over the top of the content column. It carries runtime
// state only while that state is worth reading: preparing, offline, a failure,
// or a waiting update. Data management lives in Settings, Data and privacy.
export function HostedStatusPill({ host, actions }) {
  const initialProgress = host.getRuntimeProgress?.();
  const [status, setStatus] = useState({
    role: host.getRole?.() || "candidate",
    online: navigator.onLine,
    busy: false,
    phase: initialProgress?.phase || "booting",
    message: initialProgress?.message || "Starting browser runtime…",
    actionError: "",
  });
  const waitingWorker = useWaitingServiceWorker();

  useEffect(() => {
    let disposed = false;
    const refresh = (message) => {
      if (disposed) return;
      setStatus((current) =>
        refreshHostedRuntimeStatus(current, message, {
          online: navigator.onLine,
          role: host.getRole?.() || current.role,
        }),
      );
    };
    void host
      .ready?.()
      .then(refresh)
      .catch((error) =>
        refresh({ error: error instanceof Error ? error.message : String(error) }),
      );
    const unsubscribe = host.subscribe?.(refresh);
    addEventListener("online", refresh);
    addEventListener("offline", refresh);
    return () => {
      disposed = true;
      unsubscribe?.();
      removeEventListener("online", refresh);
      removeEventListener("offline", refresh);
    };
  }, [host]);

  const installUpdate = async () => {
    if (!waitingWorker || !actions) return;
    setStatus((current) => ({
      ...current,
      busy: true,
      message: "Saving work before update…",
      actionError: "",
    }));
    try {
      await actions.installUpdate(waitingWorker);
      setStatus((current) =>
        refreshHostedRuntimeStatus({ ...current, busy: false, actionError: "" }, undefined, {
          online: navigator.onLine,
          role: host.getRole?.() || current.role,
        }),
      );
    } catch (error) {
      setStatus((current) => ({
        ...current,
        busy: false,
        actionError: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const view = hostedStatusPillView(status, { updateWaiting: Boolean(waitingWorker) });
  if (!view) return null;

  if (view.kind === "action") {
    return (
      <Button
        type="button"
        variant="bordered"
        size="xs"
        rounded="full"
        // The offer keeps the pill's 28px geometry. The pseudo-element widens
        // the pointer target to 40px without growing the floating chrome.
        className="relative h-7 min-h-7 shrink-0 px-3 text-xs shadow-subtle-sm before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
        disabled={status.busy}
        onClick={installUpdate}
      >
        {view.text}
      </Button>
    );
  }

  const alerting = view.kind === "alert";
  return (
    <Badge
      variant={alerting ? "destructive" : "outline"}
      size="lg"
      role={alerting ? "alert" : "status"}
      title={view.text}
      className={cn(
        "min-w-0 max-w-full shrink overflow-hidden rounded-full shadow-subtle-sm",
        alerting ? null : "bg-card text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          alerting ? "bg-destructive" : "bg-muted-foreground",
        )}
      />
      <span className="truncate">{view.text}</span>
    </Badge>
  );
}
