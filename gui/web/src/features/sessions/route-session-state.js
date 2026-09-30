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
  currentSessionRunActive = false,
}) {
  const routeSessionId = sessionIdFromPath(pathname);
  // Home while the current session is still running (started on its own
  // session route): home is a new chat, so it must not show that transcript
  // or its Stop control. It is an empty draft bound to no session; sending
  // from it starts a fresh session.
  if (pathname === "/" && currentSessionRunActive) {
    return {
      routeSessionId: "",
      pendingSessionSwitch: false,
      pendingFreshHomeSession: false,
      homeDraft: true,
      activeSessionId: "",
      events: [],
    };
  }
  const pendingSessionSwitch = Boolean(routeSessionId && routeSessionId !== currentSessionId);
  const shouldHideHomeSession =
    canStartFreshHomeSession && pathname === "/" && pendingFreshHomeSession;
  const streaming = runState === "connecting" || runState === "streaming";

  return {
    routeSessionId,
    pendingSessionSwitch,
    pendingFreshHomeSession: shouldHideHomeSession,
    homeDraft: false,
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
  currentSessionRunActive = false,
}) {
  const routeSessionId = sessionIdFromPath(pathname);
  if (routeSessionId) return { mode: "route", sessionId: routeSessionId };
  if (
    supportsSessionActions &&
    canStartFreshHomeSession &&
    (hasCurrentSessionContent || currentSessionRunActive)
  ) {
    return { mode: "fresh" };
  }
  return { mode: "current" };
}

/**
 * gui.coordination is a single global value the browser last received for
 * whichever session it fetched it for (a route-scoped /sessions/:id visit
 * reports coordination for that one session). Using it for a different,
 * currently active session is stale: visiting a session another process
 * owns and then navigating to a page keyed off a different session (for
 * example after starting a fresh chat) must not keep treating that new
 * session as read-only just because the old session's coordination object
 * is still sitting in state.
 */
export function resolveSessionScopedCoordination(coordination, activeSessionId) {
  return coordination?.sessionId === activeSessionId ? coordination : undefined;
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
