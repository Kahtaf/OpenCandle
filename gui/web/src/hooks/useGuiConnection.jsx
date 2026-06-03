import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

const EMPTY_DASHBOARD = {
  watchlist: [],
  activeAnalyses: [],
  recentResearch: [],
  dataQuality: { softGaps: [], hardSkips: [] },
};

export function useGuiConnection() {
  const wsRef = useRef(null);
  const [role, setRole] = useState("connecting");
  const [catalog, setCatalog] = useState({ tools: [], workflows: [], providers: [] });
  const [sessions, setSessions] = useState([]);
  const [entries, setEntries] = useState([]);
  const [events, setEvents] = useState([]);
  const [askUserPrompts, setAskUserPrompts] = useState([]);
  const [dashboard, setDashboard] = useState(EMPTY_DASHBOARD);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [modelSetup, setModelSetup] = useState({ requirement: "unknown", providers: [], availableModels: [] });
  const [supportsSessionActions, setSupportsSessionActions] = useState(false);
  const [toast, setToast] = useState("");

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
      setModelSetup(data.modelSetup || { requirement: "unknown", providers: [], availableModels: [] });
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
        const message = JSON.parse(event.data);
        if (message.type === "boot") {
          receivedBoot = true;
          window.clearTimeout(bootTimeout);
          setSupportsSessionActions(true);
          setRole(message.role);
          setCurrentSessionId(message.sessionId);
          setAskUserPrompts(message.askUserPrompts || []);
          startTransition(() => {
            setCatalog(message.catalog);
            setModelSetup(message.modelSetup || { requirement: "unknown", providers: [], availableModels: [] });
          });
        } else if (message.type === "catalog") {
          startTransition(() => setCatalog(message.catalog));
        } else if (message.type === "model.setup") {
          startTransition(() => setModelSetup(message.modelSetup || { requirement: "unknown", providers: [], availableModels: [] }));
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
        } else if (message.type === "error") {
          setToast(message.message);
        }
      };
      ws.onclose = () => {
        window.clearTimeout(bootTimeout);
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

  const send = useCallback((type, payload = {}) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== 1 || typeof socket.send !== "function") {
      setToast("GUI connection is not open.");
      return false;
    }
    socket.send(JSON.stringify({ type, ...payload }));
    return true;
  }, []);

  const newSession = useCallback(async () => {
    try {
      const response = await fetch("/api/session/new", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || response.statusText);
      setSupportsSessionActions(true);
      applyBootstrap(data);
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [applyBootstrap]);

  return useMemo(() => ({
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
    toast,
    setToast,
    send,
    newSession,
  }), [role, catalog, sessions, entries, events, askUserPrompts, dashboard, currentSessionId, modelSetup, supportsSessionActions, toast, send, newSession]);
}

function upsertPrompt(current, prompt) {
  if (!prompt?.id) return current;
  const next = current.filter((item) => item.id !== prompt.id);
  next.push(prompt);
  return next;
}
