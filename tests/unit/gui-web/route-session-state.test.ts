import { describe, expect, it } from "vitest";
import {
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

  it("hides stale entries while a clicked session is still switching", () => {
    const view = routeSessionView({
      pathname: "/sessions/next-session",
      currentSessionId: "previous-session",
      entries: [{ type: "message", id: "stale" }],
      runState: "ready",
      liveBaseEntryCount: 0,
    });

    expect(view.pendingSessionSwitch).toBe(true);
    expect(view.activeSessionId).toBe("next-session");
    expect(view.entries).toEqual([]);
  });

  it("hides an existing transcript on home while a fresh session starts", () => {
    const view = routeSessionView({
      pathname: "/",
      currentSessionId: "session-with-history",
      entries: [{ type: "message", id: "stale-home-entry" }],
      runState: "ready",
      liveBaseEntryCount: 0,
    });

    expect(view.activeSessionId).toBe("session-with-history");
    expect(view.pendingFreshHomeSession).toBe(true);
    expect(view.entries).toEqual([]);
  });

  it("keeps the existing live-entry de-dupe during streaming", () => {
    const view = routeSessionView({
      pathname: "/sessions/current-session",
      currentSessionId: "current-session",
      entries: [{ id: "base-1" }, { id: "duplicated-live" }],
      runState: "streaming",
      liveBaseEntryCount: 1,
    });

    expect(view.entries).toEqual([{ id: "base-1" }]);
  });

  it("starts a fresh writer session when home is showing an existing transcript", () => {
    expect(shouldStartFreshHomeSession({
      pathname: "/",
      role: "writer",
      currentSessionId: "session-with-history",
      entryCount: 2,
      lastResetSessionId: "",
    })).toBe(true);

    expect(shouldStartFreshHomeSession({
      pathname: "/sessions/session-with-history",
      role: "writer",
      currentSessionId: "session-with-history",
      entryCount: 2,
      lastResetSessionId: "",
    })).toBe(false);

    expect(shouldStartFreshHomeSession({
      pathname: "/",
      role: "writer",
      currentSessionId: "session-with-history",
      entryCount: 2,
      lastResetSessionId: "session-with-history",
    })).toBe(false);
  });
});
