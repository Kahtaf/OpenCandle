import { useEffect, useRef, useState } from "react";

export function refreshHostedRuntimeStatus(current, message, environment) {
  const next = {
    ...current,
    role: environment.role || current.role,
    online: environment.online,
  };
  if (message?.error) {
    return { ...next, message: message.error };
  }
  return {
    ...next,
    message: environment.online
      ? environment.role === "follower"
        ? "Connected to the active tab"
        : "Running on this device"
      : "Offline: saved research is read-only",
  };
}

export function HostedRuntimePanel({ host }) {
  const [status, setStatus] = useState({
    role: host.getRole?.() || "candidate",
    online: navigator.onLine,
    busy: false,
    message: "Starting browser runtime…",
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
      setStatus((current) => ({
        ...current,
        busy: false,
        message: navigator.onLine ? "Running on this device" : "Offline: saved research is read-only",
        actionError: "",
      }));
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
    run("Clearing model key…", () => host.handleCommand({ type: "hosted.data.clear_secrets" }));

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
              ? "This tab sends actions to the active writer tab."
              : "The Pi runtime, sessions, and market state stay in this browser profile."}
          </p>
          <div className="hosted-runtime-actions">
            {waitingWorker ? <button type="button" onClick={installUpdate} disabled={status.busy}>Install update</button> : null}
            <button type="button" onClick={exportData} disabled={status.busy}>Export data</button>
            <button type="button" onClick={() => importRef.current?.click()} disabled={status.busy}>Import data</button>
            <button type="button" onClick={clearSecrets} disabled={status.busy}>Clear model key</button>
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
