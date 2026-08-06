import { useEffect, useState } from "react";
import { Badge } from "../../web/src/components/ui/badge.jsx";
import { Button } from "../../web/src/components/ui/button.jsx";
import { hostedStatusPillView, refreshHostedRuntimeStatus } from "./hosted-runtime-status.js";

// Quiet chrome beside the OpenCandle logo. It carries runtime state only while
// that state is worth reading: preparing, offline, a failure, or a waiting
// update. Data management lives in Settings, Data and privacy.
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
  const [waitingWorker, setWaitingWorker] = useState(null);

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
    const updateReady = (event) => setWaitingWorker(event.detail?.registration?.waiting ?? null);
    addEventListener("opencandle:update-ready", updateReady);
    return () => {
      disposed = true;
      unsubscribe?.();
      removeEventListener("online", refresh);
      removeEventListener("offline", refresh);
      removeEventListener("opencandle:update-ready", updateReady);
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
        className="shrink-0"
        disabled={status.busy}
        onClick={installUpdate}
      >
        {view.text}
      </Button>
    );
  }

  return (
    <Badge
      variant={view.kind === "alert" ? "destructive" : "outline"}
      role={view.kind === "alert" ? "alert" : "status"}
      title={view.text}
      className="min-w-0 max-w-[11rem] shrink overflow-hidden"
    >
      <span className="truncate">{view.text}</span>
    </Badge>
  );
}
