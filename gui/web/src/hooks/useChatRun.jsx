import { useCallback, useMemo, useRef, useState } from "react";

const CURRENT_SESSION_KEY = "__current__";

function normalizeSessionId(sessionId) {
  return String(sessionId ?? "").trim();
}

function runStateKey(sessionId) {
  return normalizeSessionId(sessionId) || CURRENT_SESSION_KEY;
}

export function chatRunEndpoint(sessionId) {
  const targetSessionId = normalizeSessionId(sessionId);
  return targetSessionId
    ? `/api/sessions/${encodeURIComponent(targetSessionId)}/runs`
    : "/api/chat/run";
}

export function createSessionActionId(prefix = "action") {
  const random =
    globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export function buildChatRunRequestBody(prompt, sessionId, actionId) {
  const expectedSessionId = normalizeSessionId(sessionId);
  const body = { prompt, actionId };
  return expectedSessionId ? { ...body, sessionId: expectedSessionId } : body;
}

export function isSessionChangedChatRunError(status, errorBody) {
  return status === 409 && errorBody?.code === "session_changed";
}

export function useChatRun({ activeSessionId = "", setToast, onEvent, onRunStart }) {
  const abortsRef = useRef(new Map());
  const runStatesRef = useRef({});
  const [runStates, setRunStates] = useState({});
  const [lastRuns, setLastRuns] = useState({});

  const setRunStateFor = useCallback((key, nextState) => {
    setRunStates((current) => {
      const updated = { ...current, [key]: nextState };
      runStatesRef.current = updated;
      return updated;
    });
  }, []);

  const startChatRun = useCallback(
    async (prompt, options = {}) => {
      const trimmed = String(prompt || "").trim();
      const targetSessionId = normalizeSessionId(options.sessionId || activeSessionId);
      const key = runStateKey(targetSessionId);
      const currentRunState = runStatesRef.current[key] || "ready";
      if (!trimmed || currentRunState === "connecting" || currentRunState === "streaming") return;
      const actionId = options.actionId || createSessionActionId("chat");
      setLastRuns((current) => ({
        ...current,
        [key]: { prompt: trimmed, sessionId: targetSessionId, actionId },
      }));
      setRunStateFor(key, "connecting");
      setToast("");
      onRunStart?.(trimmed, options.baseEventCount, targetSessionId);
      const abort = new AbortController();
      abortsRef.current.set(key, abort);

      try {
        const response = await fetch(chatRunEndpoint(targetSessionId), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildChatRunRequestBody(trimmed, targetSessionId, actionId)),
          signal: abort.signal,
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: response.statusText }));
          if (isSessionChangedChatRunError(response.status, error)) {
            setRunStateFor(key, "ready");
            return { sessionChanged: true };
          }
          throw new Error(error.error || response.statusText);
        }
        setRunStateFor(key, "streaming");
        await drainSse(response, (event) => {
          onEvent?.(event, targetSessionId);
          if (event.type === "run.failed") {
            setRunStateFor(key, "failed");
            setToast(event.error?.message || "Run failed");
          }
          if (event.type === "run.completed") setRunStateFor(key, "ready");
        });
        setRunStates((current) => {
          const updated = {
            ...current,
            [key]: current[key] === "failed" ? "failed" : "ready",
          };
          runStatesRef.current = updated;
          return updated;
        });
      } catch (error) {
        if (error?.name === "AbortError") {
          setToast("Stopped response.");
          setRunStateFor(key, "ready");
        } else {
          setToast(error?.message || String(error));
          setRunStateFor(key, "failed");
        }
      } finally {
        abortsRef.current.delete(key);
      }
    },
    [activeSessionId, setRunStateFor, setToast, onEvent, onRunStart],
  );

  const stopRun = useCallback(
    (sessionId = activeSessionId) => {
      abortsRef.current.get(runStateKey(sessionId))?.abort();
    },
    [activeSessionId],
  );

  const retryRun = useCallback(
    (sessionId = activeSessionId) => {
      const lastRun = lastRuns[runStateKey(sessionId)];
      if (lastRun) {
        void startChatRun(lastRun.prompt, {
          sessionId: lastRun.sessionId,
          actionId: lastRun.actionId,
        });
      }
    },
    [activeSessionId, lastRuns, startChatRun],
  );

  const activeKey = runStateKey(activeSessionId);
  const runState = runStates[activeKey] || "ready";
  const lastRun = lastRuns[activeKey] || null;
  const lastPrompt = lastRun?.prompt ?? "";

  return useMemo(
    () => ({
      runState,
      runStates,
      lastPrompt,
      startChatRun,
      stopRun,
      retryRun,
    }),
    [runState, runStates, lastPrompt, startChatRun, stopRun, retryRun],
  );
}

async function drainSse(response, onEvent) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf("\n\n");
    while (index !== -1) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data));
      } catch {
        // Ignore malformed SSE blocks.
      }
      index = buffer.indexOf("\n\n");
    }
  }
}
