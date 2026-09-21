import { describe, expect, it } from "vitest";
import {
  chatRunSessionTarget,
  resolveSessionScopedCoordination,
  routeSessionView,
  sessionIdFromPath,
  shouldStartFreshHomeSession,
} from "../../../gui/web/src/features/sessions/route-session-state.js";

describe("route session state", () => {
  it("decodes the session id from session routes", () => {
    expect(sessionIdFromPath("/sessions/session-123")).toBe("session-123");
    expect(sessionIdFromPath("/sessions/session%20abc")).toBe("session abc");
    expect(sessionIdFromPath("/")).toBe("");
  });

  it("hides stale events while a clicked session is still switching", () => {
    const view = routeSessionView({
      pathname: "/sessions/next-session",
      currentSessionId: "previous-session",
      events: [messageCompleted("stale", "stale transcript")],
      runState: "ready",
      liveBaseEventCount: 0,
    });

    expect(view.pendingSessionSwitch).toBe(true);
    expect(view.activeSessionId).toBe("next-session");
    expect(view.events).toEqual([]);
  });

  it("hides an existing transcript on home while a fresh session starts", () => {
    const view = routeSessionView({
      pathname: "/",
      currentSessionId: "session-with-history",
      events: [messageCompleted("stale-home-entry", "stale home transcript")],
      runState: "ready",
      liveBaseEventCount: 0,
      pendingFreshHomeSession: true,
    });

    expect(view.activeSessionId).toBe("session-with-history");
    expect(view.pendingFreshHomeSession).toBe(true);
    expect(view.events).toEqual([]);
  });

  it("keeps home action-capable when its already-fresh session receives content", () => {
    const events = [messageCompleted("forwarded-entry", "follower response")];
    const view = routeSessionView({
      pathname: "/",
      currentSessionId: "fresh-home-session",
      events,
      runState: "ready",
      liveBaseEventCount: 0,
      pendingFreshHomeSession: false,
    });

    expect(view.pendingFreshHomeSession).toBe(false);
    expect(view.events).toBe(events);
  });

  it("does not treat session metadata events as stale home transcript content", () => {
    const events = [
      {
        type: "session.updated",
        sessionId: "fresh-session",
        updatedAt: "2026-06-12T00:00:00.000Z",
        seq: 1,
      },
      { type: "run.started", runId: "run-1", sessionId: "fresh-session", seq: 2 },
    ];
    const view = routeSessionView({
      pathname: "/",
      currentSessionId: "fresh-session",
      events,
      runState: "ready",
      liveBaseEventCount: 0,
    });

    expect(view.pendingFreshHomeSession).toBe(false);
    expect(view.events).toBe(events);
  });

  it("keeps the existing home transcript when session actions are unavailable", () => {
    const events = [messageCompleted("existing-home-entry", "existing home transcript")];
    const view = routeSessionView({
      pathname: "/",
      currentSessionId: "session-with-history",
      events,
      runState: "ready",
      liveBaseEventCount: 0,
      canStartFreshHomeSession: false,
    });

    expect(view.pendingFreshHomeSession).toBe(false);
    expect(view.events).toBe(events);
  });

  it("keeps the existing persisted-event base during streaming", () => {
    const view = routeSessionView({
      pathname: "/sessions/current-session",
      currentSessionId: "current-session",
      events: [
        {
          type: "session.updated",
          sessionId: "current-session",
          updatedAt: "2026-06-12T00:00:00.000Z",
          seq: 1,
        },
        messageCompleted("duplicated-live", "live duplicate"),
      ],
      runState: "streaming",
      liveBaseEventCount: 1,
    });

    expect(view.events).toEqual([
      {
        type: "session.updated",
        sessionId: "current-session",
        updatedAt: "2026-06-12T00:00:00.000Z",
        seq: 1,
      },
    ]);
  });

  it("targets the route session for sends on session routes", () => {
    expect(
      chatRunSessionTarget({
        pathname: "/sessions/session-1",
        supportsSessionActions: true,
      }),
    ).toEqual({ mode: "route", sessionId: "session-1" });
  });

  it("targets a fresh session for home sends when home shows existing content", () => {
    expect(
      chatRunSessionTarget({
        pathname: "/",
        supportsSessionActions: true,
        hasCurrentSessionContent: true,
      }),
    ).toEqual({ mode: "fresh" });
  });

  it("uses the current session for empty home sends", () => {
    expect(
      chatRunSessionTarget({
        pathname: "/",
        supportsSessionActions: true,
        hasCurrentSessionContent: false,
      }),
    ).toEqual({ mode: "current" });
  });

  it("uses the current home session when this window cannot create fresh sessions", () => {
    expect(
      chatRunSessionTarget({
        pathname: "/",
        supportsSessionActions: true,
        hasCurrentSessionContent: true,
        canStartFreshHomeSession: false,
      }),
    ).toEqual({ mode: "current" });
  });

  it("falls back to the unguarded current session when session actions are unavailable", () => {
    expect(
      chatRunSessionTarget({
        pathname: "/",
        supportsSessionActions: false,
      }),
    ).toEqual({ mode: "current" });
  });

  it("starts a fresh session when home is showing an existing transcript and session actions are available", () => {
    expect(
      shouldStartFreshHomeSession({
        pathname: "/",
        currentSessionId: "session-with-history",
        entryCount: 2,
        lastResetSessionId: "",
      }),
    ).toBe(true);

    expect(
      shouldStartFreshHomeSession({
        pathname: "/sessions/session-with-history",
        currentSessionId: "session-with-history",
        entryCount: 2,
        lastResetSessionId: "",
      }),
    ).toBe(false);

    expect(
      shouldStartFreshHomeSession({
        pathname: "/",
        currentSessionId: "session-with-history",
        entryCount: 2,
        lastResetSessionId: "session-with-history",
      }),
    ).toBe(false);

    expect(
      shouldStartFreshHomeSession({
        pathname: "/",
        currentSessionId: "fresh-session-after-reset",
        entryCount: 2,
        lastResetSessionId: "session-with-history",
      }),
    ).toBe(false);

    expect(
      shouldStartFreshHomeSession({
        pathname: "/",
        currentSessionId: "session-with-history",
        entryCount: 2,
        lastResetSessionId: "",
        canStartFreshHomeSession: false,
      }),
    ).toBe(false);
  });

  it("uses coordination that matches the active session", () => {
    const coordination = { sessionId: "session-a", marketStateWritable: false, ownerKind: "tui" };
    expect(resolveSessionScopedCoordination(coordination, "session-a")).toBe(coordination);
  });

  it("ignores coordination left over from a different, no-longer-active session", () => {
    // Regression coverage: visiting a saved session another process owns
    // (/sessions/session-a, reporting coordination for session-a) and then
    // navigating to a page keyed off a different session (for example
    // Watchlists after starting a fresh chat) must not keep treating that
    // new session as read-only just because session-a's stale coordination
    // object is still sitting in state.
    const staleCoordination = {
      sessionId: "session-a",
      marketStateWritable: false,
      ownerKind: "tui",
    };
    expect(resolveSessionScopedCoordination(staleCoordination, "session-b")).toBeUndefined();
  });

  it("treats missing coordination as not session-scoped", () => {
    expect(resolveSessionScopedCoordination(null, "session-a")).toBeUndefined();
    expect(resolveSessionScopedCoordination(undefined, "session-a")).toBeUndefined();
  });
});

function messageCompleted(messageId: string, text: string) {
  return {
    type: "message.completed" as const,
    messageId,
    content: [{ type: "text" as const, text }],
    seq: 1,
  };
}
