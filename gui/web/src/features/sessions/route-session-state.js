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
  pendingFreshHomeSession = false,
}) {
  const routeSessionId = sessionIdFromPath(pathname);
  const pendingSessionSwitch = Boolean(routeSessionId && routeSessionId !== currentSessionId);
  const shouldHideHomeSession =
    canStartFreshHomeSession && pathname === "/" && pendingFreshHomeSession;
  const streaming = runState === "connecting" || runState === "streaming";

  return {
    routeSessionId,
    pendingSessionSwitch,
    pendingFreshHomeSession: shouldHideHomeSession,
    activeSessionId: routeSessionId || currentSessionId || "",
    events:
      pendingSessionSwitch || shouldHideHomeSession
        ? []
        : streaming
          ? events.slice(0, liveBaseEventCount)
          : events,
  };
}

export function chatRunSessionTarget({
  pathname,
  supportsSessionActions,
  hasCurrentSessionContent = false,
  canStartFreshHomeSession = true,
}) {
  const routeSessionId = sessionIdFromPath(pathname);
  if (routeSessionId) return { mode: "route", sessionId: routeSessionId };
  if (supportsSessionActions && canStartFreshHomeSession && hasCurrentSessionContent) {
    return { mode: "fresh" };
  }
  return { mode: "current" };
}

export function hasSessionContent(events) {
  return (events || []).some(
    (event) => event.type === "message.completed" || event.type === "custom.message",
  );
}

export function shouldStartFreshHomeSession({
  pathname,
  currentSessionId,
  entryCount,
  lastResetSessionId,
  canStartFreshHomeSession = true,
}) {
  return (
    pathname === "/" &&
    canStartFreshHomeSession &&
    Boolean(currentSessionId) &&
    entryCount > 0 &&
    lastResetSessionId === ""
  );
}
