/**
 * Per-session cancellation state under the session-core/extension owner
 * boundary.
 *
 * A session owns one cancellation state. Each run starts a fresh token and
 * makes it current; the extension captures the current token when a user turn
 * begins and checks it after the router await. Cancelling the token is safe
 * even before the agent run is active (e.g. Stop during input-hook routing),
 * which `AgentSession.abort()` alone cannot cover.
 *
 * The state is keyed by the AgentSession object via a WeakMap so a GUI request
 * can reach the cancellation token for a session without a global registry or
 * method monkey-patching.
 */
export interface SessionCancellationToken {
  /**
   * AbortSignal for this run. Forwarded to the router LLM transport so Stop
   * actually closes the in-flight HTTP request instead of leaving it held.
   */
  readonly signal: AbortSignal;
  cancel(): void;
  isCancelled(): boolean;
}

export interface SessionCancellationState {
  current: SessionCancellationToken | null;
}

export function createSessionCancellationToken(): SessionCancellationToken {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    cancel() {
      controller.abort();
    },
    isCancelled() {
      return controller.signal.aborted;
    },
  };
}

export function createSessionCancellationState(): SessionCancellationState {
  return { current: null };
}

export function startSessionRun(state: SessionCancellationState): SessionCancellationToken {
  const token = createSessionCancellationToken();
  state.current = token;
  return token;
}

export function finishSessionRun(
  state: SessionCancellationState,
  token: SessionCancellationToken,
): void {
  if (state.current === token) state.current = null;
}

const sessionCancellationStates = new WeakMap<object, SessionCancellationState>();

export function attachSessionCancellationState(
  session: object,
  state: SessionCancellationState,
): void {
  sessionCancellationStates.set(session, state);
}

export function getSessionCancellationState(
  session: object | null | undefined,
): SessionCancellationState | undefined {
  if (!session || typeof session !== "object") return undefined;
  return sessionCancellationStates.get(session);
}
