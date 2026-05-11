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
  const [dashboard, setDashboard] = useState(EMPTY_DASHBOARD);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [modelSetup, setModelSetup] = useState({ requirement: "unknown", providers: [], availableModels: [] });
  const [toast, setToast] = useState("");

  useEffect(() => {
    let disposed = false;
    let reconnect = 0;

    const connect = () => {
      const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${wsProtocol}//${location.host}/ws`);
      wsRef.current = ws;
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "boot") {
          setRole(message.role);
          setCurrentSessionId(message.sessionId);
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
        } else if (message.type === "error") {
          setToast(message.message);
        }
      };
      ws.onclose = () => {
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
  }, []);

  const send = useCallback((type, payload = {}) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setToast("GUI connection is not open.");
      return false;
    }
    wsRef.current.send(JSON.stringify({ type, ...payload }));
    return true;
  }, []);

  return useMemo(() => ({
    role,
    catalog,
    sessions,
    entries,
    events,
    dashboard,
    currentSessionId,
    modelSetup,
    toast,
    setToast,
    send,
  }), [role, catalog, sessions, entries, events, dashboard, currentSessionId, modelSetup, toast, send]);
}
