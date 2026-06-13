import { describe, expect, it } from "vitest";
import {
  buildChatRunRequestBody,
  isSessionChangedChatRunError,
} from "../../../gui/web/src/hooks/useChatRun.jsx";

describe("chat run request helpers", () => {
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
