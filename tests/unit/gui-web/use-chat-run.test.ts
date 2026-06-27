import { describe, expect, it } from "vitest";
import {
  buildChatRunRequestBody,
  chatRunEndpoint,
  isSessionChangedChatRunError,
} from "../../../gui/web/src/hooks/useChatRun.jsx";

describe("chat run request helpers", () => {
  it("uses a session-addressed run endpoint when a session id is provided", () => {
    expect(chatRunEndpoint("session-1")).toBe("/api/sessions/session-1/runs");
    expect(chatRunEndpoint("session/with/slash")).toBe("/api/sessions/session%2Fwith%2Fslash/runs");
  });

  it("keeps the legacy run endpoint only when no session id is available", () => {
    expect(chatRunEndpoint()).toBe("/api/chat/run");
    expect(chatRunEndpoint("")).toBe("/api/chat/run");
    expect(chatRunEndpoint("   ")).toBe("/api/chat/run");
  });

  it("includes the expected session id when provided", () => {
    expect(buildChatRunRequestBody("hello", "session-1")).toEqual({
      prompt: "hello",
      sessionId: "session-1",
    });
  });

  it("omits the session id when the caller has none", () => {
    expect(buildChatRunRequestBody("hello")).toEqual({ prompt: "hello" });
    expect(buildChatRunRequestBody("hello", "")).toEqual({ prompt: "hello" });
    expect(buildChatRunRequestBody("hello", "   ")).toEqual({ prompt: "hello" });
  });

  it("recognizes the session-changed conflict response", () => {
    expect(isSessionChangedChatRunError(409, { code: "session_changed" })).toBe(true);
    expect(isSessionChangedChatRunError(409, { error: "Read-only follower mode" })).toBe(false);
    expect(isSessionChangedChatRunError(400, { code: "session_changed" })).toBe(false);
    expect(isSessionChangedChatRunError(409, null)).toBe(false);
  });
});
