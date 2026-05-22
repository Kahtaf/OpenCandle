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
}) {
  const routeSessionId = sessionIdFromPath(pathname);
  const pendingSessionSwitch = Boolean(routeSessionId && routeSessionId !== currentSessionId);
  const pendingFreshHomeSession = pathname === "/" && entries.length > 0;
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

export function shouldStartFreshHomeSession({
  pathname,
  role,
  currentSessionId,
  entryCount,
  lastResetSessionId,
}) {
  return pathname === "/"
    && role === "writer"
    && Boolean(currentSessionId)
    && entryCount > 0
    && lastResetSessionId !== currentSessionId;
}
