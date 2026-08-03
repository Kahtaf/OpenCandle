import { useCallback, useMemo, useRef, useState } from "react";
import { useRuntimeTransport } from "../runtime/runtime-transport-context.js";

const CURRENT_SESSION_KEY = "__current__";

function normalizeSessionId(sessionId) {
  return String(sessionId ?? "").trim();
}

function runStateKey(sessionId) {
  return normalizeSessionId(sessionId) || CURRENT_SESSION_KEY;
}

export function chatRunEndpoint(sessionId) {
  const targetSessionId = normalizeSessionId(sessionId);
  if (!targetSessionId) throw new Error("sessionId is required");
  return `/api/sessions/${encodeURIComponent(targetSessionId)}/runs`;
}

export function createSessionActionId(prefix = "action") {
  const random =
    globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export function buildChatRunRequestBody(prompt, sessionId, actionId, extras = {}) {
  const expectedSessionId = normalizeSessionId(sessionId);
  if (!expectedSessionId) throw new Error("sessionId is required");
  const body = { prompt, actionId, ...extras };
  return { ...body, sessionId: expectedSessionId };
}

export function buildRetryChatRunOptions(lastRun) {
  if (!lastRun) return null;
  return {
    sessionId: lastRun.sessionId,
    ...(lastRun.actionId ? { actionId: lastRun.actionId } : {}),
    ...(Array.isArray(lastRun.images) && lastRun.images.length > 0
      ? { images: lastRun.images }
      : {}),
    ...(Array.isArray(lastRun.attachments) && lastRun.attachments.length > 0
      ? { attachments: lastRun.attachments }
      : {}),
  };
}

export function isSessionChangedChatRunError(status, errorBody) {
  return status === 409 && errorBody?.code === "session_changed";
}

export function isDuplicateChatRunAck(body) {
  return body?.ok === true && body?.duplicate === true;
}

export function useChatRun({ activeSessionId = "", setToast, onEvent, onRunStart, onRunError }) {
  const transport = useRuntimeTransport();
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
      if (!targetSessionId) {
        setToast("sessionId is required");
        return;
      }
      const actionId = options.actionId || createSessionActionId("chat");
      const runExtras = {
        ...(Array.isArray(options.images) && options.images.length > 0
          ? { images: options.images }
          : {}),
        ...(Array.isArray(options.attachments) && options.attachments.length > 0
          ? { attachments: options.attachments }
          : {}),
      };
      const optimisticAttachments = Array.isArray(options.optimisticAttachments)
        ? options.optimisticAttachments
        : [];
      setLastRuns((current) => ({
        ...current,
        [key]: { prompt: trimmed, sessionId: targetSessionId, actionId, ...runExtras },
      }));
      setRunStateFor(key, "connecting");
      setToast("");
      onRunStart?.(trimmed, options.baseEventCount, targetSessionId, {
        attachments: optimisticAttachments,
      });
      const abort = new AbortController();
      abortsRef.current.set(key, abort);

      try {
        const response = await transport.startChatRun(
          targetSessionId,
          buildChatRunRequestBody(trimmed, targetSessionId, actionId, runExtras),
          abort.signal,
        );
        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: response.statusText }));
          if (isSessionChangedChatRunError(response.status, error)) {
            setRunStateFor(key, "ready");
            return { sessionChanged: true };
          }
          throw new Error(error.error || response.statusText);
        }
        if (response.headers.get("content-type")?.includes("application/json")) {
          const body = await response.json().catch(() => null);
          if (isDuplicateChatRunAck(body)) {
            setRunStateFor(key, "ready");
            return { duplicate: true };
          }
        }
        setRunStateFor(key, "streaming");
        await drainSse(response, (event) => {
          onEvent?.(event, targetSessionId);
          if (event.type === "run.failed") {
            setLastRuns((current) => ({
              ...current,
              [key]: { prompt: trimmed, sessionId: targetSessionId, actionId: "", ...runExtras },
            }));
            // A terminal failure can arrive as a valid SSE event rather than a
            // transport exception. Remove the local queued projection in both
            // cases; otherwise the composer leaves a permanently "Queued"
            // message even though the run has already reached its terminal
            // state.
            onRunError?.(targetSessionId);
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
        onRunError?.(targetSessionId);
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
    [activeSessionId, setRunStateFor, setToast, onEvent, onRunStart, onRunError, transport],
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
      const retryOptions = buildRetryChatRunOptions(lastRun);
      if (lastRun && retryOptions) void startChatRun(lastRun.prompt, retryOptions);
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
