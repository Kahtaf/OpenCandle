import { describe, expect, it } from "vitest";
import {
  buildChatRunRequestBody,
  buildRetryChatRunOptions,
  buildRunCancelRequestBody,
  chatRunCancelEndpoint,
  chatRunEndpoint,
  createSessionActionId,
  isDuplicateChatRunAck,
  isSessionChangedChatRunError,
  RUN_CANCEL_UNCONFIRMED_MESSAGE,
  runCancelUnconfirmedMessage,
} from "../../../gui/web/src/hooks/useChatRun.jsx";

describe("chat run request helpers", () => {
  it("uses a session-addressed run endpoint when a session id is provided", () => {
    expect(chatRunEndpoint("session-1")).toBe("/api/sessions/session-1/runs");
    expect(chatRunEndpoint("session/with/slash")).toBe("/api/sessions/session%2Fwith%2Fslash/runs");
  });

  it("rejects chat run endpoints without an explicit session id", () => {
    expect(() => chatRunEndpoint()).toThrow("sessionId is required");
    expect(() => chatRunEndpoint("")).toThrow("sessionId is required");
    expect(() => chatRunEndpoint("   ")).toThrow("sessionId is required");
  });

  it("includes the expected session id when provided", () => {
    expect(buildChatRunRequestBody("hello", "session-1", "action-1")).toEqual({
      prompt: "hello",
      sessionId: "session-1",
      actionId: "action-1",
    });
  });

  it("includes images and saved context attachments in session-addressed run bodies", () => {
    expect(
      buildChatRunRequestBody("review this", "session-a", "chat-1", {
        images: [{ data: "base64", mimeType: "image/png" }],
        attachments: [{ kind: "portfolio" }],
      }),
    ).toEqual({
      prompt: "review this",
      actionId: "chat-1",
      sessionId: "session-a",
      images: [{ data: "base64", mimeType: "image/png" }],
      attachments: [{ kind: "portfolio" }],
    });
  });

  it("rejects chat run bodies without an explicit session id", () => {
    expect(() => buildChatRunRequestBody("hello", "", "action-1")).toThrow("sessionId is required");
    expect(() => buildChatRunRequestBody("hello", "   ", "action-1")).toThrow(
      "sessionId is required",
    );
  });

  it("mints distinct action ids for deliberate run submissions", () => {
    const first = createSessionActionId("chat");
    const second = createSessionActionId("chat");

    expect(first).toMatch(/^chat-/);
    expect(second).toMatch(/^chat-/);
    expect(second).not.toBe(first);
  });

  it("recognizes the session-changed conflict response", () => {
    expect(isSessionChangedChatRunError(409, { code: "session_changed" })).toBe(true);
    expect(isSessionChangedChatRunError(409, { error: "Read-only follower mode" })).toBe(false);
    expect(isSessionChangedChatRunError(400, { code: "session_changed" })).toBe(false);
    expect(isSessionChangedChatRunError(409, null)).toBe(false);
  });

  it("recognizes duplicate chat run acknowledgements", () => {
    expect(isDuplicateChatRunAck({ ok: true, duplicate: true })).toBe(true);
    expect(isDuplicateChatRunAck({ ok: true })).toBe(false);
    expect(isDuplicateChatRunAck(null)).toBe(false);
  });

  it("reuses the prior action id for transport retries", () => {
    expect(
      buildRetryChatRunOptions({
        prompt: "hello",
        sessionId: "session-1",
        actionId: "chat-action-1",
      }),
    ).toEqual({ sessionId: "session-1", actionId: "chat-action-1" });
  });

  it("preserves image and saved-context attachments for failed-run retries", () => {
    expect(
      buildRetryChatRunOptions({
        prompt: "review this chart",
        sessionId: "session-1",
        actionId: "chat-action-1",
        images: [{ data: "base64", mimeType: "image/png" }],
        attachments: [{ kind: "portfolio" }],
      }),
    ).toEqual({
      sessionId: "session-1",
      actionId: "chat-action-1",
      images: [{ data: "base64", mimeType: "image/png" }],
      attachments: [{ kind: "portfolio" }],
    });
  });

  it("omits cleared action ids for deliberate failed-run retries", () => {
    expect(
      buildRetryChatRunOptions({
        prompt: "hello",
        sessionId: "session-1",
        actionId: "",
      }),
    ).toEqual({ sessionId: "session-1" });
  });

  it("builds a session-addressed run-cancel endpoint", () => {
    expect(chatRunCancelEndpoint("session-1")).toBe("/api/sessions/session-1/run-cancel");
    expect(chatRunCancelEndpoint("session/with/slash")).toBe(
      "/api/sessions/session%2Fwith%2Fslash/run-cancel",
    );
    expect(() => chatRunCancelEndpoint()).toThrow("sessionId is required");
  });

  it("targets the original chat action id in a run-cancel body", () => {
    expect(buildRunCancelRequestBody("session-1", "stop-1", "chat-1")).toEqual({
      sessionId: "session-1",
      actionId: "stop-1",
      targetActionId: "chat-1",
    });
    expect(() => buildRunCancelRequestBody("", "stop-1", "chat-1")).toThrow(
      "sessionId is required",
    );
    expect(() => buildRunCancelRequestBody("session-1", "stop-1", "")).toThrow(
      "targetActionId is required",
    );
  });

  it("reports an unconfirmed server stop only when cancellation is rejected or refused", () => {
    expect(runCancelUnconfirmedMessage({ ok: true, cancelled: true, duplicate: false })).toBeNull();
    expect(
      runCancelUnconfirmedMessage({ ok: true, cancelled: false, reason: "no_active_run" }),
    ).toBeNull();
    expect(
      runCancelUnconfirmedMessage({ ok: true, cancelled: false, reason: "stale_target" }),
    ).toBeNull();
    expect(runCancelUnconfirmedMessage({ ok: false, cancelled: false })).toBe(
      RUN_CANCEL_UNCONFIRMED_MESSAGE,
    );
    expect(runCancelUnconfirmedMessage(undefined)).toBe(RUN_CANCEL_UNCONFIRMED_MESSAGE);
  });
});
