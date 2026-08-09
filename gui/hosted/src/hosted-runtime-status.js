// What the status pill beside the logo should say, if anything. A ready runtime
// is the normal case and says nothing at all: the pill exists for states that
// pass, so it never becomes a permanent "running in this browser" label.
export function hostedStatusPillView(status, { updateWaiting } = {}) {
  if (status.actionError) return { kind: "alert", text: status.actionError };
  if (status.busy) return { kind: "status", text: status.message };
  // A failed runtime outranks the update offer: hiding the failure behind an
  // install prompt would misreport why the app is not working.
  if (status.phase === "error") return { kind: "status", text: status.message };
  if (updateWaiting) return { kind: "action", text: "Install update?" };
  if (status.phase === "ready") return null;
  return { kind: "status", text: status.message };
}

export function refreshHostedRuntimeStatus(current, message, environment) {
  const next = {
    ...current,
    role: environment.role || current.role,
    online: environment.online,
  };
  if (message?.type === "runtime-progress") {
    if (message.error) return { ...next, phase: "error", message: message.error };
    return {
      ...next,
      phase: message.phase || current.phase,
      message: message.message || current.message,
    };
  }
  if (message?.error) {
    return { ...next, phase: "error", message: message.error };
  }
  if (environment.online && environment.role === "writer" && current.phase === "booting") {
    return next;
  }
  return {
    ...next,
    phase: environment.online ? "ready" : "offline",
    message: environment.online
      ? environment.role === "follower"
        ? "Ready through the active tab"
        : "Running on this device"
      : "Offline: saved research is read-only",
  };
}
