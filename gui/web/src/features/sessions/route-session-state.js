export function sessionIdFromPath(pathname) {
  const match = String(pathname || "").match(/^\/sessions\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

export function routeSessionView({
  pathname,
  currentSessionId,
  entries,
  runState,
  liveBaseEntryCount,
  canStartFreshHomeSession = true,
}) {
  const routeSessionId = sessionIdFromPath(pathname);
  const pendingSessionSwitch = Boolean(routeSessionId && routeSessionId !== currentSessionId);
  const pendingFreshHomeSession = canStartFreshHomeSession && pathname === "/" && hasSessionContent(entries);
  const streaming = runState === "connecting" || runState === "streaming";

  return {
    routeSessionId,
    pendingSessionSwitch,
    pendingFreshHomeSession,
    activeSessionId: routeSessionId || currentSessionId || "",
    entries: pendingSessionSwitch || pendingFreshHomeSession
      ? []
      : streaming
        ? entries.slice(0, liveBaseEntryCount)
        : entries,
  };
}

export function chatRunSessionTarget({ pathname, supportsSessionActions }) {
  const routeSessionId = sessionIdFromPath(pathname);
  if (routeSessionId) return { mode: "route", sessionId: routeSessionId };
  if (supportsSessionActions) return { mode: "fresh" };
  return { mode: "current" };
}

export function hasSessionContent(entries) {
  return entries.some((entry) => entry.type === "message" || entry.type === "custom_message");
}

export function shouldStartFreshHomeSession({
  pathname,
  role,
  currentSessionId,
  entryCount,
  lastResetSessionId,
  canStartFreshHomeSession = true,
}) {
  return pathname === "/"
    && role === "writer"
    && canStartFreshHomeSession
    && Boolean(currentSessionId)
    && entryCount > 0
    && lastResetSessionId === "";
}
