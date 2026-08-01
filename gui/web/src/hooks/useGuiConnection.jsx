import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "../components/ui/use-toast.jsx";
import { useRuntimeTransport } from "../runtime/runtime-transport-context.js";

const EMPTY_DASHBOARD = {
  knownSymbols: [],
  watchlist: [],
  activeAnalyses: [],
  recentResearch: [],
  dataQuality: { softGaps: [], hardSkips: [] },
};

const EMPTY_CATALOG = { tools: [], workflows: [], providers: [] };
const EMPTY_MODEL_SETUP = { requirement: "unknown", providers: [], availableModels: [] };
const GLOBAL_GUI_COMMANDS = new Set([
  "model.setup.refresh",
  "model.setup.save_api_key",
  "model.setup.select_model",
  "provider.save_api_key",
]);

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

export function buildHttpFallbackMessageRequest(type, payload = {}) {
  switch (type) {
    case "model.setup.refresh":
      return { path: "/api/model-setup/refresh", body: {} };
    case "model.setup.save_api_key":
      return {
        path: "/api/model-setup/api-key",
        body: {
          provider: payload.provider,
          apiKey: payload.apiKey,
          ...(payload.storageMode ? { storageMode: payload.storageMode } : {}),
        },
      };
    case "model.setup.select_model":
      return {
        path: "/api/model-setup/model",
        body: { provider: payload.provider, modelId: payload.modelId },
      };
    case "provider.save_api_key":
      return {
        path: "/api/provider-setup/api-key",
        body: { providerId: payload.providerId, apiKey: payload.apiKey },
      };
    default:
      return null;
  }
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

export function sessionSnapshotFromPayload(payload) {
  const record = asRecord(payload);
  const nestedSnapshot = asRecord(record.snapshot);
  const snapshot = Object.keys(nestedSnapshot).length > 0 ? nestedSnapshot : record;
  const sessionId = String(record.sessionId ?? snapshot.sessionId ?? "").trim();
  if (!sessionId) return null;
  const dashboard = asRecord(snapshot.state);
  return {
    sessionId,
    entries: Array.isArray(snapshot.entries) ? snapshot.entries : [],
    events: Array.isArray(snapshot.events) ? snapshot.events : [],
    dashboard: Object.keys(dashboard).length > 0 ? dashboard : EMPTY_DASHBOARD,
  };
}

export function mergeSessionSnapshotMap(current, payload) {
  const snapshot = sessionSnapshotFromPayload(payload);
  return snapshot ? { ...current, [snapshot.sessionId]: snapshot } : current;
}

export function buildToolInvokeSocketMessage(payload, currentSessionId = "", targetSessionId = "") {
  const sessionId = String(targetSessionId || currentSessionId || "").trim();
  if (!sessionId) throw new Error("sessionId is required");
  return {
    type: "tool.invoke",
    actionId: payload.actionId || createSessionActionId("tool"),
    ...payload,
    ...(sessionId ? { sessionId } : {}),
  };
}

export function buildToolInvokeHttpFallbackRequest(
  toolName,
  args = {},
  currentSessionId = "",
  targetSessionId = "",
  options = {},
) {
  const sessionId = String(targetSessionId || currentSessionId || "").trim();
  if (!sessionId) throw new Error("sessionId is required");
  return {
    path: "/api/tool-invoke",
    body: {
      actionId: createSessionActionId("tool"),
      sessionId,
      toolName,
      args,
      ...(options.recordTranscript === false ? { recordTranscript: false } : {}),
    },
  };
}

export function createSessionActionId(prefix = "action") {
  const random =
    globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export function buildSessionActionSocketMessage(type, payload = {}, currentSessionId = "") {
  const actionPrefix = type.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "action";
  const sessionId = String(payload.sessionId || currentSessionId || "").trim();
  if (!sessionId && !GLOBAL_GUI_COMMANDS.has(type)) throw new Error("sessionId is required");
  return {
    type,
    ...payload,
    actionId: payload.actionId || createSessionActionId(actionPrefix),
    ...(sessionId ? { sessionId } : {}),
  };
}

export function resolveBootstrapRole(currentRole, data, updateRole = true) {
  return updateRole ? data.role || "writer" : currentRole;
}

export function resolveBootstrapSessionId(
  currentSessionId,
  responseSessionId,
  updateSession = true,
) {
  return updateSession ? responseSessionId : currentSessionId;
}

export function resolveSnapshotCoordination(current, coordination) {
  if (!coordination) return current;
  // Only refresh coordination we are already tracking for that session;
  // a snapshot for the server's current session must not clobber the
  // coordination bootstrapped for a different routed session.
  if (!current || current.sessionId === coordination.sessionId) return coordination;
  return current;
}

export function shouldReconnectOnForeground({ documentVisibility, readyState }) {
  if (documentVisibility && documentVisibility !== "visible") return false;
  return readyState !== 0 && readyState !== 1;
}

export function resolveEventChannelBootTimeout(transportKind) {
  return transportKind === "hosted" ? 120_000 : 1_500;
}

export function resolveWritableRole(role, coordination) {
  return coordination?.writable === true && role === "follower" ? "writer" : role;
}

export function useGuiConnection() {
  const transport = useRuntimeTransport();
  const wsRef = useRef(null);
  const requestSeqRef = useRef(0);
  const pendingToolInvokesRef = useRef(new Map());
  const [role, setRole] = useState("connecting");
  const [catalog, setCatalog] = useState({ tools: [], workflows: [], providers: [] });
  const [sessions, setSessions] = useState([]);
  const [entries, setEntries] = useState([]);
  const [events, setEvents] = useState([]);
  const [sessionSnapshots, setSessionSnapshots] = useState({});
  const [askUserPrompts, setAskUserPrompts] = useState([]);
  const [dashboard, setDashboard] = useState(EMPTY_DASHBOARD);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [coordination, setCoordination] = useState(null);
  const [modelSetup, setModelSetup] = useState(transport.initialModelSetup || EMPTY_MODEL_SETUP);
  const [supportsSessionActions, setSupportsSessionActions] = useState(false);

  const setToast = useCallback((message, options = {}) => {
    const payload = buildGuiToastPayload(message, options);
    if (!payload) return;
    toast(payload);
  }, []);

  const setModelSetupError = useCallback((message) => {
    setModelSetup((current) => ({ ...current, error: String(message) }));
  }, []);

  const settleToolInvoke = useCallback((requestId, settle, payload) => {
    settlePendingToolInvoke(pendingToolInvokesRef.current, requestId, settle, payload);
  }, []);

  const applyBootstrap = useCallback((data, expectedSessionId = "", options = {}) => {
    const snapshot = data.snapshot || {};
    const nextSnapshot = sessionSnapshotFromPayload(data);
    const responseSessionId = String(data.sessionId || snapshot.sessionId || "").trim();
    if (expectedSessionId && responseSessionId !== expectedSessionId) return false;
    const updateVisibleState = options.updateVisibleState !== false;
    setRole((currentRole) => resolveBootstrapRole(currentRole, data, options.updateRole !== false));
    setCoordination(data.coordination || null);
    setCurrentSessionId((currentSessionId) =>
      resolveBootstrapSessionId(
        currentSessionId,
        responseSessionId,
        options.updateCurrentSessionId !== false,
      ),
    );
    setAskUserPrompts(data.askUserPrompts || []);
    if (updateVisibleState) setEntries(nextSnapshot?.entries || []);
    if (nextSnapshot) setSessionSnapshots((current) => mergeSessionSnapshotMap(current, data));
    startTransition(() => {
      setSessions(data.sessions || []);
      if (updateVisibleState) {
        setDashboard(nextSnapshot?.dashboard || EMPTY_DASHBOARD);
        setEvents(nextSnapshot?.events || []);
      }
      setCatalog(data.catalog || { tools: [], workflows: [], providers: [] });
      setModelSetup(
        data.modelSetup || { requirement: "unknown", providers: [], availableModels: [] },
      );
    });
    return true;
  }, []);

  useEffect(() => {
    let disposed = false;
    let reconnect = 0;

    const connectHttpFallback = async () => {
      try {
        wsRef.current = null;
        const data = await transport.bootstrap();
        if (disposed) return;
        setSupportsSessionActions(data.supportsSessionActions !== false);
        applyBootstrap(data);
      } catch {
        if (!disposed) setRole("disconnected");
      }
    };

    const connect = () => {
      let ws;
      let usingHttpFallback = false;
      let receivedBoot = false;
      let bootTimeout;
      try {
        ws = transport.openEventChannel({
          onMessage: (rawMessage) => {
            let message;
            try {
              message = JSON.parse(rawMessage);
            } catch {
              setToast("Received malformed GUI server message.", { destructive: true });
              return;
            }
            if (message.type === "boot") {
              receivedBoot = true;
              window.clearTimeout(bootTimeout);
              setSupportsSessionActions(true);
              setRole(message.role);
              setCoordination(message.coordination || null);
              setCurrentSessionId(message.sessionId);
              setAskUserPrompts(message.askUserPrompts || []);
              startTransition(() => {
                setCatalog(message.catalog);
                setModelSetup(
                  message.modelSetup || {
                    requirement: "unknown",
                    providers: [],
                    availableModels: [],
                  },
                );
              });
            } else if (message.type === "runtime.status") {
              setRole(message.role);
              setCoordination((current) =>
                resolveSnapshotCoordination(current, message.coordination),
              );
              setAskUserPrompts(message.askUserPrompts || []);
              startTransition(() => {
                setCatalog(message.catalog || EMPTY_CATALOG);
                setModelSetup(message.modelSetup || EMPTY_MODEL_SETUP);
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
                  message.modelSetup || {
                    requirement: "unknown",
                    providers: [],
                    availableModels: [],
                  },
                ),
              );
            } else if (message.type === "sessions") {
              startTransition(() => setSessions(message.sessions));
            } else if (message.type === "state.snapshot") {
              const nextSnapshot = sessionSnapshotFromPayload(message);
              setEntries(nextSnapshot?.entries || []);
              setCurrentSessionId(message.sessionId || "");
              setCoordination((current) =>
                resolveSnapshotCoordination(current, message.coordination),
              );
              if (nextSnapshot) {
                setSessionSnapshots((current) => mergeSessionSnapshotMap(current, message));
              }
              startTransition(() => {
                setDashboard(nextSnapshot?.dashboard || EMPTY_DASHBOARD);
                setEvents(nextSnapshot?.events || []);
              });
            } else if (message.type === "session.snapshot") {
              const nextSnapshot = sessionSnapshotFromPayload(message);
              if (nextSnapshot) {
                setSessionSnapshots((current) => mergeSessionSnapshotMap(current, message));
              }
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
              if (String(message.message || "").startsWith("Key was rejected by ")) {
                setModelSetupError(message.message);
              }
              setToast(message.message, { destructive: true });
            }
          },
          onClose: () => {
            window.clearTimeout(bootTimeout);
            if (wsRef.current !== ws) return;
            for (const [requestId, pending] of pendingToolInvokesRef.current) {
              window.clearTimeout(pending.timeout);
              pending.reject(new Error("GUI connection closed before the tool finished."));
              pendingToolInvokesRef.current.delete(requestId);
            }
            if (usingHttpFallback) return;
            setSupportsSessionActions(false);
            setRole("disconnected");
            if (!disposed) reconnect = window.setTimeout(connect, 1000);
          },
        });
      } catch {
        void connectHttpFallback();
        return;
      }
      if (!ws) {
        void connectHttpFallback();
        return;
      }
      bootTimeout = window.setTimeout(() => {
        if (receivedBoot || disposed) return;
        usingHttpFallback = true;
        ws.close();
        void connectHttpFallback();
      }, resolveEventChannelBootTimeout(transport.kind));
      wsRef.current = ws;
    };

    const reconnectOnForeground = () => {
      if (disposed) return;
      const documentVisibility =
        typeof document === "undefined" ? "visible" : document.visibilityState;
      if (
        !shouldReconnectOnForeground({
          documentVisibility,
          readyState: wsRef.current?.readyState,
        })
      ) {
        return;
      }
      window.clearTimeout(reconnect);
      setSupportsSessionActions(false);
      setRole("connecting");
      wsRef.current?.close?.();
      connect();
    };

    connect();
    window.addEventListener("focus", reconnectOnForeground);
    document.addEventListener("visibilitychange", reconnectOnForeground);
    return () => {
      disposed = true;
      window.clearTimeout(reconnect);
      window.removeEventListener("focus", reconnectOnForeground);
      document.removeEventListener("visibilitychange", reconnectOnForeground);
      wsRef.current?.close();
    };
  }, [applyBootstrap, setModelSetupError, setToast, settleToolInvoke, transport]);

  const sendHttpFallbackMessage = useCallback(
    async (request) => {
      try {
        const data = await transport.postCommand(request.path, request.body);
        applyBootstrap(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (request.type === "model.setup.save_api_key") setModelSetupError(message);
        setToast(message, { destructive: true });
      }
    },
    [applyBootstrap, setModelSetupError, setToast, transport],
  );

  const send = useCallback(
    (type, payload = {}) => {
      const socket = wsRef.current;
      if (socket?.readyState !== 1 || typeof socket.send !== "function") {
        const request = buildHttpFallbackMessageRequest(type, payload);
        if (!request) {
          setToast("GUI connection is not open.", { destructive: true });
          return false;
        }
        void sendHttpFallbackMessage({ ...request, type });
        return true;
      }
      try {
        socket.send(
          JSON.stringify(
            type === "tool.invoke"
              ? buildToolInvokeSocketMessage(payload, currentSessionId, payload.sessionId)
              : buildSessionActionSocketMessage(type, payload, currentSessionId),
          ),
        );
        return true;
      } catch (error) {
        setToast(error instanceof Error ? error.message : String(error), { destructive: true });
        return false;
      }
    },
    [currentSessionId, sendHttpFallbackMessage, setToast],
  );

  const invokeTool = useCallback(
    async (toolName, args = {}, targetSessionId = "", options = {}) => {
      const socket = wsRef.current;
      if (socket?.readyState !== 1 || typeof socket.send !== "function") {
        try {
          const request = buildToolInvokeHttpFallbackRequest(
            toolName,
            args,
            currentSessionId,
            targetSessionId,
            options,
          );
          return await transport.invokeTool(request.body);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setToast(message, { destructive: true });
          return Promise.reject(new Error(message));
        }
      }

      const requestId = `tool-${Date.now()}-${requestSeqRef.current++}`;
      const actionId = createSessionActionId("tool");
      const timeout = window.setTimeout(() => {
        rejectTimedOutToolInvoke(pendingToolInvokesRef.current, requestId);
      }, 30_000);

      const promise = new Promise((resolve, reject) => {
        pendingToolInvokesRef.current.set(requestId, { resolve, reject, timeout });
      });

      try {
        socket.send(
          JSON.stringify(
            buildToolInvokeSocketMessage(
              {
                requestId,
                actionId,
                toolName,
                args,
                ...(options.recordTranscript === false ? { recordTranscript: false } : {}),
              },
              currentSessionId,
              targetSessionId,
            ),
          ),
        );
      } catch (error) {
        window.clearTimeout(timeout);
        pendingToolInvokesRef.current.delete(requestId);
        const message = error instanceof Error ? error.message : String(error);
        setToast(message, { destructive: true });
        return Promise.reject(new Error(message));
      }
      return promise;
    },
    [currentSessionId, setToast, transport],
  );

  const newSession = useCallback(async () => {
    try {
      const data = await transport.createSession();
      setSupportsSessionActions(true);
      applyBootstrap(data);
      return String(data?.sessionId ?? "");
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error), { destructive: true });
      return "";
    }
  }, [applyBootstrap, setToast, transport]);

  const loadSession = useCallback(
    async (sessionId) => {
      const targetSessionId = String(sessionId ?? "").trim();
      if (!targetSessionId) return false;
      try {
        const data = await transport.loadSession(targetSessionId);
        setSupportsSessionActions(true);
        return applyBootstrap(data, targetSessionId, {
          updateCurrentSessionId: false,
          updateRole: false,
          updateVisibleState: false,
        });
      } catch (error) {
        setToast(error instanceof Error ? error.message : String(error), { destructive: true });
        return false;
      }
    },
    [applyBootstrap, setToast, transport],
  );

  return useMemo(
    () => ({
      role: resolveWritableRole(role, coordination),
      catalog,
      sessions,
      entries,
      events,
      sessionSnapshots,
      askUserPrompts,
      dashboard,
      currentSessionId,
      coordination,
      modelSetup,
      supportsSessionActions,
      setToast,
      send,
      invokeTool,
      newSession,
      loadSession,
      adoptSessionId: setCurrentSessionId,
    }),
    [
      role,
      coordination,
      catalog,
      sessions,
      entries,
      events,
      sessionSnapshots,
      askUserPrompts,
      dashboard,
      currentSessionId,
      modelSetup,
      supportsSessionActions,
      setToast,
      send,
      invokeTool,
      newSession,
      loadSession,
    ],
  );
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
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
