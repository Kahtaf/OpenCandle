import { describe, expect, it } from "vitest";
import {
  attachSessionCancellationState,
  createSessionCancellationState,
  createSessionCancellationToken,
  finishSessionRun,
  getSessionCancellationState,
  startSessionRun,
} from "../../../src/pi/session-cancellation.js";

describe("session cancellation token", () => {
  it("starts uncancelled and flips once cancelled", () => {
    const token = createSessionCancellationToken();
    expect(token.isCancelled()).toBe(false);
    token.cancel();
    expect(token.isCancelled()).toBe(true);
  });

  it("exposes an AbortSignal that aborts when the token is cancelled", () => {
    const token = createSessionCancellationToken();
    expect(token.signal).toBeInstanceOf(AbortSignal);
    expect(token.signal.aborted).toBe(false);

    token.cancel();

    expect(token.signal.aborted).toBe(true);
    expect(token.isCancelled()).toBe(true);
  });

  it("tracks the current run token on a session cancellation state", () => {
    const state = createSessionCancellationState();
    expect(state.current).toBeNull();

    const token = startSessionRun(state);
    expect(state.current).toBe(token);
    expect(token.isCancelled()).toBe(false);

    token.cancel();
    expect(state.current?.isCancelled()).toBe(true);
  });

  it("only clears the current token when the matching run finishes", () => {
    const state = createSessionCancellationState();
    const first = startSessionRun(state);
    const second = startSessionRun(state);

    finishSessionRun(state, first);
    expect(state.current).toBe(second);

    finishSessionRun(state, second);
    expect(state.current).toBeNull();
  });

  it("attaches cancellation state to a specific session object without leaking across sessions", () => {
    const stateA = createSessionCancellationState();
    const stateB = createSessionCancellationState();
    const sessionA = { id: "a" };
    const sessionB = { id: "b" };

    attachSessionCancellationState(sessionA, stateA);
    attachSessionCancellationState(sessionB, stateB);

    expect(getSessionCancellationState(sessionA)).toBe(stateA);
    expect(getSessionCancellationState(sessionB)).toBe(stateB);
    expect(getSessionCancellationState({ id: "c" })).toBeUndefined();
    expect(getSessionCancellationState(undefined)).toBeUndefined();
  });
});
