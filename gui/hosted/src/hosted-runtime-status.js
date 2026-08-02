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
