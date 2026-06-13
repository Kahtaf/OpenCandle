export function sessionIdFromPath(pathname) {
  const match = String(pathname || "").match(/^\/sessions\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

export function routeSessionView({
  pathname,
  currentSessionId,
  events,
  runState,
  liveBaseEventCount,
  canStartFreshHomeSession = true,
}) {
  const routeSessionId = sessionIdFromPath(pathname);
  const pendingSessionSwitch = Boolean(routeSessionId && routeSessionId !== currentSessionId);
  const pendingFreshHomeSession =
    canStartFreshHomeSession && pathname === "/" && hasSessionContent(events);
  const streaming = runState === "connecting" || runState === "streaming";

  return {
    routeSessionId,
    pendingSessionSwitch,
    pendingFreshHomeSession,
    activeSessionId: routeSessionId || currentSessionId || "",
    events:
      pendingSessionSwitch || pendingFreshHomeSession
        ? []
        : streaming
          ? events.slice(0, liveBaseEventCount)
          : events,
  };
}

export function chatRunSessionTarget({ pathname, supportsSessionActions }) {
  const routeSessionId = sessionIdFromPath(pathname);
  if (routeSessionId) return { mode: "route", sessionId: routeSessionId };
  if (supportsSessionActions) return { mode: "fresh" };
  return { mode: "current" };
}

export function hasSessionContent(events) {
  return (events || []).some(
    (event) => event.type === "message.completed" || event.type === "custom.message",
  );
}

export function shouldStartFreshHomeSession({
  pathname,
  role,
  currentSessionId,
  entryCount,
  lastResetSessionId,
  canStartFreshHomeSession = true,
}) {
  return (
    pathname === "/" &&
    role === "writer" &&
    canStartFreshHomeSession &&
    Boolean(currentSessionId) &&
    entryCount > 0 &&
    lastResetSessionId === ""
  );
}
