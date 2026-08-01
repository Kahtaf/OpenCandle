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
