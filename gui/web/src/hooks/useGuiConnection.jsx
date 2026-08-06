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
  "model.setup.set_thinking",
  "provider.save_api_key",
]);

export const TOOL_INVOKE_TIMEOUT_MESSAGE =
  "The operation is still running. OpenCandle will refresh state when the server finishes.";

export function resolveToolInvokeTimeout(transportKind) {
  // A hosted mutation includes a durable browser checkpoint after the Pi tool
  // result. WebContainer/OPFS can legitimately take longer than the local
  // server round trip, so do not abandon an acknowledged save at 30 seconds.
  return transportKind === "hosted" ? 120_000 : 30_000;
}

export function buildGuiToastPayload(message, options = {}) {
  if (!message) return null;
  return {
    title: options.title,
    description: String(message),
    variant: options.variant || (options.destructive ? "destructive" : "default"),
  };
}

// Attribute a socket `error` frame to model setup.
//
// The server's error frame echoes the failing request's `actionId`, so an
// exact match against the in-flight key save is what marks a failure as a
// model-setup failure. Everything else — an untagged frame, or a frame from a
// different request that happened to fail while a save was in flight — falls
// back to the literal rejection prefix, which is unambiguous on its own. This
// is what stops an unrelated failure from being painted as a key rejection
// while the real save failure degrades to toast-only.
export function resolveModelSetupErrorFromSocketError(message, options = {}) {
  const text = String(message || "").trim();
  if (!text) return "";
  const actionId = String(options.actionId || "");
  const pendingActionId = String(options.pendingModelKeySaveActionId || "");
  if (actionId && pendingActionId && actionId === pendingActionId) return text;
  return text.startsWith("Key was rejected by ") ? text : "";
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
    case "model.setup.set_thinking":
      return {
        path: "/api/model-setup/thinking",
        body: { level: payload.level },
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

export function resolveSupportsSessionActions(supported, role, coordination) {
  return supported !== false && role !== "offline" && coordination?.writable !== false;
}

export function useGuiConnection() {
  const transport = useRuntimeTransport();
  const wsRef = useRef(null);
  const requestSeqRef = useRef(0);
  const pendingToolInvokesRef = useRef(new Map());
  // actionId of the key save currently in flight over the socket, or "".
  const pendingModelKeySaveRef = useRef("");
  const [role, setRole] = useState("connecting");
  const [catalog, setCatalog] = useState({ tools: [], workflows: [], providers: [] });
  const [preferencesSnapshot, setPreferencesSnapshot] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [entries, setEntries] = useState([]);
  const [events, setEvents] = useState([]);
  const [sessionSnapshots, setSessionSnapshots] = useState({});
  const [askUserPrompts, setAskUserPrompts] = useState([]);
  const [dashboard, setDashboard] = useState(EMPTY_DASHBOARD);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [currentSessionPersisted, setCurrentSessionPersisted] = useState(false);
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
    if (options.updateCurrentSessionId !== false) {
      setCurrentSessionPersisted(data.sessionPersisted === true);
    }
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
        setSupportsSessionActions(
          resolveSupportsSessionActions(data.supportsSessionActions, data.role, data.coordination),
        );
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
              setSupportsSessionActions(
                resolveSupportsSessionActions(
                  message.supportsSessionActions,
                  message.role,
                  message.coordination,
                ),
              );
              setRole(message.role);
              setCoordination(message.coordination || null);
              setCurrentSessionId(message.sessionId);
              setCurrentSessionPersisted(message.sessionPersisted === true);
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
              setSupportsSessionActions((current) =>
                resolveSupportsSessionActions(
                  message.supportsSessionActions ?? current,
                  message.role,
                  message.coordination,
                ),
              );
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
            } else if (message.type === "preferences") {
              startTransition(() =>
                setPreferencesSnapshot({
                  preferences: message.preferences || [],
                  toolDefaults: message.toolDefaults || [],
                }),
              );
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
              // Runtime-status and partial projections can arrive while a
              // replacement writer is restoring its checkpoint. They do not
              // always repeat the selected session id, and must not erase the
              // valid id received in the preceding boot payload.
              setCurrentSessionId((currentSessionId) => message.sessionId || currentSessionId);
              if (message.sessionId) setCurrentSessionPersisted(message.sessionPersisted === true);
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
              const inlineSetupError = resolveModelSetupErrorFromSocketError(message.message, {
                actionId: message.actionId,
                pendingModelKeySaveActionId: pendingModelKeySaveRef.current,
              });
              if (message.actionId && message.actionId === pendingModelKeySaveRef.current) {
                pendingModelKeySaveRef.current = "";
              }
              // An error rendered inline in model setup is not also toasted:
              // it would duplicate the message the user is already looking at,
              // and a Radix Toast mounts its own dismissable layer above the
              // setup dialog, which would then swallow the first Escape.
              if (inlineSetupError) setModelSetupError(inlineSetupError);
              else setToast(message.message, { destructive: true });
            }
          },
          onClose: () => {
            window.clearTimeout(bootTimeout);
            if (wsRef.current !== ws) return;
            pendingModelKeySaveRef.current = "";
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
    const handleOffline = () => {
      // The browser runtime can retain its elected writer role while a network
      // transition is still propagating through the hosted transport. Disable
      // every action surface immediately; saved checkpoints remain readable,
      // but no mutation may be queued until the connection is restored.
      setSupportsSessionActions(false);
      setRole("offline");
    };
    const handleOnline = () => reconnectOnForeground();
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    if (navigator.onLine === false) handleOffline();
    window.addEventListener("focus", reconnectOnForeground);
    document.addEventListener("visibilitychange", reconnectOnForeground);
    return () => {
      disposed = true;
      window.clearTimeout(reconnect);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
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
        // Same rule as the socket path: inline in setup, or a toast, not both.
        if (request.type === "model.setup.save_api_key") setModelSetupError(message);
        else setToast(message, { destructive: true });
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
        const socketMessage =
          type === "tool.invoke"
            ? buildToolInvokeSocketMessage(payload, currentSessionId, payload.sessionId)
            : buildSessionActionSocketMessage(type, payload, currentSessionId);
        if (type === "model.setup.save_api_key") {
          pendingModelKeySaveRef.current = String(socketMessage.actionId || "");
        }
        socket.send(JSON.stringify(socketMessage));
        return true;
      } catch (error) {
        // The request never left the browser, so nothing can answer it.
        if (type === "model.setup.save_api_key") pendingModelKeySaveRef.current = "";
        setToast(error instanceof Error ? error.message : String(error), { destructive: true });
        return false;
      }
    },
    [currentSessionId, sendHttpFallbackMessage, setToast],
  );

  const invokeTool = useCallback(
    async (toolName, args = {}, targetSessionId = "", options = {}) => {
      let resolvedSessionId = String(targetSessionId || currentSessionId).trim();
      if (!resolvedSessionId) {
        try {
          const bootstrap = await transport.bootstrap();
          resolvedSessionId = String(
            bootstrap?.sessionId || bootstrap?.snapshot?.sessionId || "",
          ).trim();
          if (!resolvedSessionId) throw new Error("Open a session before running this tool.");
          setCurrentSessionId(resolvedSessionId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setToast(message, { destructive: true });
          return Promise.reject(new Error(message));
        }
      }
      const socket = wsRef.current;
      if (socket?.readyState !== 1 || typeof socket.send !== "function") {
        try {
          const request = buildToolInvokeHttpFallbackRequest(
            toolName,
            args,
            resolvedSessionId,
            resolvedSessionId,
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
      }, resolveToolInvokeTimeout(transport.kind));

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
              resolvedSessionId,
              resolvedSessionId,
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
        setSupportsSessionActions(
          resolveSupportsSessionActions(data.supportsSessionActions, data.role, data.coordination),
        );
        return applyBootstrap(data, targetSessionId, {
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
      currentSessionPersisted,
      coordination,
      modelSetup,
      preferencesSnapshot,
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
      currentSessionPersisted,
      modelSetup,
      preferencesSnapshot,
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
