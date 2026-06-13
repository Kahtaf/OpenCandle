import { useCallback, useMemo, useRef, useState } from "react";

export function buildChatRunRequestBody(prompt, sessionId) {
  const expectedSessionId = String(sessionId ?? "").trim();
  return expectedSessionId ? { prompt, sessionId: expectedSessionId } : { prompt };
}

export function isSessionChangedChatRunError(status, errorBody) {
  return status === 409 && errorBody?.code === "session_changed";
}

export function useChatRun({ setToast, onEvent, onRunStart }) {
  const abortRef = useRef(null);
  const [runState, setRunState] = useState("ready");
  const [lastRun, setLastRun] = useState(null);

  const startChatRun = useCallback(
    async (prompt, options = {}) => {
      const trimmed = String(prompt || "").trim();
      if (!trimmed || runState === "connecting" || runState === "streaming") return;
      setLastRun({ prompt: trimmed, sessionId: options.sessionId });
      setRunState("connecting");
      setToast("");
      onRunStart?.(trimmed, options.baseEventCount);
      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const response = await fetch("/api/chat/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildChatRunRequestBody(trimmed, options.sessionId)),
          signal: abort.signal,
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: response.statusText }));
          if (isSessionChangedChatRunError(response.status, error)) {
            setRunState("ready");
            return { sessionChanged: true };
          }
          throw new Error(error.error || response.statusText);
        }
        setRunState("streaming");
        await drainSse(response, (event) => {
          onEvent?.(event);
          if (event.type === "run.failed") {
            setRunState("failed");
            setToast(event.error?.message || "Run failed");
          }
          if (event.type === "run.completed") setRunState("ready");
        });
        setRunState((state) => (state === "failed" ? "failed" : "ready"));
      } catch (error) {
        if (error?.name === "AbortError") {
          setToast("Stopped response.");
          setRunState("ready");
        } else {
          setToast(error?.message || String(error));
          setRunState("failed");
        }
      } finally {
        abortRef.current = null;
      }
    },
    [runState, setToast, onEvent, onRunStart],
  );

  const stopRun = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retryRun = useCallback(() => {
    if (lastRun) void startChatRun(lastRun.prompt, { sessionId: lastRun.sessionId });
  }, [lastRun, startChatRun]);

  const lastPrompt = lastRun?.prompt ?? "";

  return useMemo(
    () => ({
      runState,
      lastPrompt,
      startChatRun,
      stopRun,
      retryRun,
    }),
    [runState, lastPrompt, startChatRun, stopRun, retryRun],
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
    let index;
    while ((index = buffer.indexOf("\n\n")) !== -1) {
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
    }
  }
}
