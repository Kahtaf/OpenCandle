import { describe, expect, it } from "vitest";
import { chatRunSessionConflict } from "../../../gui/server/chat-run-session.ts";

describe("chat run session guard", () => {
  it("rejects runs whose expected session no longer matches the active session", () => {
    const conflict = chatRunSessionConflict("session-old", "session-new");

    expect(conflict).toEqual({
      error: "The active session changed before this message was sent.",
      code: "session_changed",
    });
  });

  it("allows runs that match the active session", () => {
    expect(chatRunSessionConflict("session-1", "session-1")).toBeNull();
  });

  it("allows runs that do not declare an expected session", () => {
    expect(chatRunSessionConflict(undefined, "session-1")).toBeNull();
    expect(chatRunSessionConflict("", "session-1")).toBeNull();
    expect(chatRunSessionConflict("   ", "session-1")).toBeNull();
    expect(chatRunSessionConflict(42, "session-1")).toBeNull();
  });
});
