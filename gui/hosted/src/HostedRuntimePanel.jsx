import { useEffect, useState } from "react";
import { refreshHostedRuntimeStatus } from "./hosted-runtime-status.js";

export const MANAGE_DATA_PATH = "/settings/data";

// Status only. Export, import, and clearing live in Settings, Data & privacy.
export function HostedRuntimePanel({ host, actions, onManageData }) {
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

  return (
    <aside className="hosted-runtime-panel" aria-label="Hosted OpenCandle status">
      <div className="hosted-runtime-strip">
        <span className={`hosted-runtime-dot ${status.online ? "is-online" : ""}`} />
        <span className="hosted-runtime-message">{status.message}</span>
        <span className="hosted-runtime-detail">
          {status.role === "follower"
            ? "Requests from this tab run through the active browser runtime."
            : "The Pi runtime, sessions, and market state stay in this browser profile."}
        </span>
        <div className="hosted-runtime-actions">
          {waitingWorker ? (
            <button type="button" onClick={installUpdate} disabled={status.busy}>
              Install update
            </button>
          ) : null}
          <a
            href={MANAGE_DATA_PATH}
            onClick={(event) => {
              if (!onManageData) return;
              event.preventDefault();
              onManageData();
            }}
          >
            Manage data
          </a>
        </div>
      </div>
      {status.actionError ? <p role="alert">{status.actionError}</p> : null}
    </aside>
  );
}
