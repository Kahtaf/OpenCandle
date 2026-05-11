import { useCallback, useMemo, useRef, useState } from "react";

export function useChatRun({ setToast }) {
  const abortRef = useRef(null);
  const [runState, setRunState] = useState("ready");
  const [lastPrompt, setLastPrompt] = useState("");

  const startChatRun = useCallback(async (prompt) => {
    const trimmed = String(prompt || "").trim();
    if (!trimmed || runState === "connecting" || runState === "streaming") return;
    setLastPrompt(trimmed);
    setRunState("connecting");
    setToast("");
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const response = await fetch("/api/chat/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
        signal: abort.signal,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || response.statusText);
      }
      setRunState("streaming");
      await drainSse(response, (event) => {
        if (event.type === "run.failed") {
          setRunState("failed");
          setToast(event.error?.message || "Run failed");
        }
        if (event.type === "run.completed") setRunState("ready");
      });
      setRunState((state) => state === "failed" ? "failed" : "ready");
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
  }, [runState, setToast]);

  const stopRun = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retryRun = useCallback(() => {
    if (lastPrompt) void startChatRun(lastPrompt);
  }, [lastPrompt, startChatRun]);

  return useMemo(() => ({
    runState,
    lastPrompt,
    startChatRun,
    stopRun,
    retryRun,
  }), [runState, lastPrompt, startChatRun, stopRun, retryRun]);
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
      const data = block.split("\n")
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
