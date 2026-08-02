import { useEffect, useRef, useState } from "react";
import { refreshHostedRuntimeStatus } from "./hosted-runtime-status.js";

export function HostedRuntimePanel({ host }) {
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
  const importRef = useRef(null);

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
    void host.ready?.().then(refresh).catch((error) =>
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

  const run = async (message, action) => {
    setStatus((current) => ({ ...current, busy: true, message, actionError: "" }));
    try {
      const result = await action();
      setStatus((current) =>
        refreshHostedRuntimeStatus(
          { ...current, busy: false, actionError: "" },
          undefined,
          { online: navigator.onLine, role: host.getRole?.() || current.role },
        ),
      );
      return result;
    } catch (error) {
      setStatus((current) => ({
        ...current,
        busy: false,
        actionError: error instanceof Error ? error.message : String(error),
      }));
      return null;
    }
  };

  const exportData = async () => {
    const result = await run("Preparing export…", () =>
      host.handleCommand({ type: "hosted.data.export" }),
    );
    if (!result?.archive) return;
    const url = URL.createObjectURL(new Blob([result.archive], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `opencandle-hosted-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importData = async (file) => {
    if (!file) return;
    await run("Validating import…", async () => {
      await host.handleCommand({ type: "hosted.data.import", archive: await file.text() });
      location.reload();
    });
  };

  const clearSecrets = () =>
    run("Clearing secrets…", () => host.handleCommand({ type: "hosted.data.clear_secrets" }));

  const clearAll = async () => {
    if (!confirm("Clear all OpenCandle sessions, market state, model keys, and cached app data on this device?")) return;
    await run("Clearing device data…", () => host.handleCommand({ type: "hosted.data.clear_all" }));
    location.reload();
  };

  const installUpdate = async () => {
    if (!waitingWorker) return;
    const result = await run("Saving work before update…", () =>
      host.handleCommand({ type: "hosted.runtime.prepare_update" }),
    );
    if (result?.ready) waitingWorker.postMessage({ type: "ACTIVATE_UPDATE" });
  };

  return (
    <aside className="hosted-runtime-panel" aria-label="Hosted OpenCandle status">
      <details>
        <summary>
          <span className={`hosted-runtime-dot ${status.online ? "is-online" : ""}`} />
          <span>{status.message}</span>
        </summary>
        <div className="hosted-runtime-menu">
          {status.actionError ? <p role="alert">{status.actionError}</p> : null}
          <p>
            {status.role === "follower"
              ? "Requests from this tab run through the active browser runtime."
              : "The Pi runtime, sessions, and market state stay in this browser profile."}
          </p>
          <div className="hosted-runtime-actions">
            {waitingWorker ? <button type="button" onClick={installUpdate} disabled={status.busy}>Install update</button> : null}
            <button type="button" onClick={exportData} disabled={status.busy}>Export data</button>
            <button type="button" onClick={() => importRef.current?.click()} disabled={status.busy}>Import data</button>
            <button type="button" onClick={clearSecrets} disabled={status.busy}>Clear secrets</button>
            <button type="button" className="is-destructive" onClick={clearAll} disabled={status.busy}>Clear all</button>
          </div>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => void importData(event.target.files?.[0])}
          />
        </div>
      </details>
    </aside>
  );
}
