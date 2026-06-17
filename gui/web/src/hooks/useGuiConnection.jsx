import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "../components/ui/use-toast.jsx";

const EMPTY_DASHBOARD = {
  watchlist: [],
  activeAnalyses: [],
  recentResearch: [],
  dataQuality: { softGaps: [], hardSkips: [] },
};

export const TOOL_INVOKE_TIMEOUT_MESSAGE =
  "The operation is still running. OpenCandle will refresh state when the server finishes.";

export function buildGuiToastPayload(message, options = {}) {
  if (!message) return null;
  return {
    title: options.title,
    description: String(message),
    variant: options.variant || (options.destructive ? "destructive" : "default"),
  };
}

export function settlePendingToolInvoke(pendingToolInvokes, requestId, settle, payload) {
  const pending = pendingToolInvokes.get(requestId);
  if (!pending) return false;
  globalThis.clearTimeout(pending.timeout);
  pendingToolInvokes.delete(requestId);
  pending[settle](payload);
  return true;
}

export function rejectTimedOutToolInvoke(pendingToolInvokes, requestId) {
  const pending = pendingToolInvokes.get(requestId);
  if (!pending) return false;
  pending.timedOut = true;
  pending.reject(new Error(TOOL_INVOKE_TIMEOUT_MESSAGE));
  return true;
}

export function useGuiConnection() {
  const wsRef = useRef(null);
  const requestSeqRef = useRef(0);
  const pendingToolInvokesRef = useRef(new Map());
  const [role, setRole] = useState("connecting");
  const [catalog, setCatalog] = useState({ tools: [], workflows: [], providers: [] });
  const [sessions, setSessions] = useState([]);
  const [entries, setEntries] = useState([]);
  const [events, setEvents] = useState([]);
  const [askUserPrompts, setAskUserPrompts] = useState([]);
  const [dashboard, setDashboard] = useState(EMPTY_DASHBOARD);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [modelSetup, setModelSetup] = useState({
    requirement: "unknown",
    providers: [],
    availableModels: [],
  });
  const [supportsSessionActions, setSupportsSessionActions] = useState(false);

  const setToast = useCallback((message, options = {}) => {
    const payload = buildGuiToastPayload(message, options);
    if (!payload) return;
    toast(payload);
  }, []);

  const settleToolInvoke = useCallback((requestId, settle, payload) => {
    settlePendingToolInvoke(pendingToolInvokesRef.current, requestId, settle, payload);
  }, []);

  const applyBootstrap = useCallback((data) => {
    const snapshot = data.snapshot || {};
    setRole(data.role || "writer");
    setCurrentSessionId(data.sessionId || snapshot.sessionId || "");
    setAskUserPrompts(data.askUserPrompts || []);
    setEntries(snapshot.entries || []);
    startTransition(() => {
      setSessions(data.sessions || []);
      setDashboard(snapshot.state || EMPTY_DASHBOARD);
      setEvents(snapshot.events || []);
      setCatalog(data.catalog || { tools: [], workflows: [], providers: [] });
      setModelSetup(
        data.modelSetup || { requirement: "unknown", providers: [], availableModels: [] },
      );
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    let reconnect = 0;

    const connectHttpFallback = async () => {
      try {
        wsRef.current = null;
        const response = await fetch("/api/bootstrap");
        if (!response.ok) throw new Error(response.statusText);
        const data = await response.json();
        if (disposed) return;
        setSupportsSessionActions(false);
        applyBootstrap(data);
      } catch {
        if (!disposed) setRole("disconnected");
      }
    };

    const connect = () => {
      if (typeof WebSocket !== "function") {
        void connectHttpFallback();
        return;
      }
      const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
      let ws;
      try {
        ws = new WebSocket(`${wsProtocol}//${location.host}/ws`);
      } catch {
        void connectHttpFallback();
        return;
      }
      let receivedBoot = false;
      let usingHttpFallback = false;
      const bootTimeout = window.setTimeout(() => {
        if (receivedBoot || disposed) return;
        usingHttpFallback = true;
        ws.close();
        void connectHttpFallback();
      }, 1_500);
      wsRef.current = ws;
      ws.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          setToast("Received malformed GUI server message.", { destructive: true });
          return;
        }
        if (message.type === "boot") {
          receivedBoot = true;
          window.clearTimeout(bootTimeout);
          setSupportsSessionActions(true);
          setRole(message.role);
          setCurrentSessionId(message.sessionId);
          setAskUserPrompts(message.askUserPrompts || []);
          startTransition(() => {
            setCatalog(message.catalog);
            setModelSetup(
              message.modelSetup || { requirement: "unknown", providers: [], availableModels: [] },
            );
          });
        } else if (message.type === "catalog") {
          startTransition(() => setCatalog(message.catalog));
        } else if (message.type === "provider.status") {
          startTransition(() =>
            setCatalog((current) =>
              mergeProviderStatus(current, message.providerId, message.status),
            ),
          );
        } else if (message.type === "model.setup") {
          startTransition(() =>
            setModelSetup(
              message.modelSetup || { requirement: "unknown", providers: [], availableModels: [] },
            ),
          );
        } else if (message.type === "sessions") {
          startTransition(() => setSessions(message.sessions));
        } else if (message.type === "state.snapshot") {
          setEntries(message.entries || []);
          setCurrentSessionId(message.sessionId || "");
          startTransition(() => {
            setDashboard(message.state || EMPTY_DASHBOARD);
            setEvents(message.events || []);
          });
        } else if (message.type === "ask_user.prompt" || message.type === "ask_user.resolved") {
          setAskUserPrompts((current) => upsertPrompt(current, message.prompt));
        } else if (message.type === "tool.invoke.result") {
          const requestId = typeof message.requestId === "string" ? message.requestId : "";
          if (message.ok) {
            settleToolInvoke(requestId, "resolve", message);
          } else {
            settleToolInvoke(
              requestId,
              "reject",
              new Error(message.error?.message || "Tool invocation failed"),
            );
          }
        } else if (message.type === "error") {
          setToast(message.message, { destructive: true });
        }
      };
      ws.onclose = () => {
        window.clearTimeout(bootTimeout);
        for (const [requestId, pending] of pendingToolInvokesRef.current) {
          window.clearTimeout(pending.timeout);
          pending.reject(new Error("GUI connection closed before the tool finished."));
          pendingToolInvokesRef.current.delete(requestId);
        }
        if (usingHttpFallback) return;
        setSupportsSessionActions(false);
        setRole("disconnected");
        if (!disposed) reconnect = window.setTimeout(connect, 1000);
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnect);
      wsRef.current?.close();
    };
  }, [applyBootstrap]);

  const send = useCallback(
    (type, payload = {}) => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== 1 || typeof socket.send !== "function") {
        setToast("GUI connection is not open.", { destructive: true });
        return false;
      }
      socket.send(JSON.stringify({ type, ...payload }));
      return true;
    },
    [setToast],
  );

  const invokeTool = useCallback(
    (toolName, args = {}) => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== 1 || typeof socket.send !== "function") {
        const error = new Error("GUI connection is not open.");
        setToast(error.message, { destructive: true });
        return Promise.reject(error);
      }

      const requestId = `tool-${Date.now()}-${requestSeqRef.current++}`;
      const timeout = window.setTimeout(() => {
        rejectTimedOutToolInvoke(pendingToolInvokesRef.current, requestId);
      }, 30_000);

      const promise = new Promise((resolve, reject) => {
        pendingToolInvokesRef.current.set(requestId, { resolve, reject, timeout });
      });

      socket.send(JSON.stringify({ type: "tool.invoke", requestId, toolName, args }));
      return promise;
    },
    [setToast, settleToolInvoke],
  );

  const newSession = useCallback(async () => {
    try {
      const response = await fetch("/api/session/new", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || response.statusText);
      setSupportsSessionActions(true);
      applyBootstrap(data);
      return String(data?.sessionId ?? "");
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error), { destructive: true });
      return "";
    }
  }, [applyBootstrap, setToast]);

  return useMemo(
    () => ({
      role,
      catalog,
      sessions,
      entries,
      events,
      askUserPrompts,
      dashboard,
      currentSessionId,
      modelSetup,
      supportsSessionActions,
      setToast,
      send,
      invokeTool,
      newSession,
    }),
    [
      role,
      catalog,
      sessions,
      entries,
      events,
      askUserPrompts,
      dashboard,
      currentSessionId,
      modelSetup,
      supportsSessionActions,
      setToast,
      send,
      invokeTool,
      newSession,
    ],
  );
}

function upsertPrompt(current, prompt) {
  if (!prompt?.id) return current;
  const next = current.filter((item) => item.id !== prompt.id);
  next.push(prompt);
  return next;
}

function mergeProviderStatus(catalog, providerId, status) {
  if (!providerId || !status) return catalog;
  return {
    ...catalog,
    providers: (catalog.providers || []).map((provider) =>
      provider.id === providerId
        ? {
            ...provider,
            status: status.state || provider.status,
            statusDetail: status,
          }
        : provider,
    ),
  };
}
