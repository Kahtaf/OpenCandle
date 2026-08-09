import { GUI_HTTP_COMMAND_TYPES } from "../../../shared/hosted-gui-protocol.js";
import { runtimeTransportContractVersion } from "./runtime-transport.js";

const EMPTY_CATALOG = { tools: [], workflows: [], providers: [] };
const EMPTY_MODEL_SETUP = {
  requirement: "api_key",
  providers: [],
  availableModels: [],
};
export function createHostedRuntimeTransport({ host, hostedData = null }) {
  if (!host || typeof host.request !== "function") {
    throw new Error("Hosted runtime transport requires a browser runtime host");
  }
  if (typeof host.streamRequest !== "function") {
    throw new Error("Hosted runtime transport requires streaming request support");
  }

  const subscribers = new Set();
  let closed = false;
  let selectedSessionId = "";
  let refreshGeneration = 0;

  const publish = (message) => {
    if (closed) return;
    const serialized = JSON.stringify(message);
    for (const subscriber of subscribers) subscriber(serialized);
  };

  const withBrowserState = (payload) => {
    // A follower receives the writer's bootstrap payload over BroadcastChannel.
    // The payload's role therefore describes the serving tab, not this tab.
    // The host owns the live writer/follower role, but an offline bootstrap is
    // authoritative: no tab may forward mutations while the browser is offline.
    const role =
      payload?.role === "offline" ? "offline" : host.getRole?.() || payload?.role || "writer";
    const payloadCoordination = payload?.coordination || {
      ownerKind: role === "offline" ? "offline" : "hosted",
      writable: role !== "offline",
    };
    const coordination = {
      ...payloadCoordination,
      // Hosted followers forward session actions and streams to the elected
      // writer. They are action-capable clients even though they do not own
      // the WebContainer, so keep the shared composer and market-state UI
      // enabled for every online hosted tab.
      writable: role !== "offline" && payloadCoordination.writable !== false,
    };
    return {
      ...payload,
      role,
      coordination,
      supportsSessionActions:
        payload?.supportsSessionActions !== false &&
        role !== "offline" &&
        coordination.writable !== false,
      catalog: payload?.catalog || EMPTY_CATALOG,
      modelSetup: host.getModelSetup?.() || payload?.modelSetup || EMPTY_MODEL_SETUP,
    };
  };

  const requestGui = (payload, options) => host.request("gui", payload, options);

  const publishBootstrap = (payload) => {
    const bootstrap = withBrowserState(payload);
    publish({
      type: "runtime.status",
      role: bootstrap.role,
      coordination: bootstrap.coordination,
      supportsSessionActions: bootstrap.supportsSessionActions,
      catalog: bootstrap.catalog,
      modelSetup: bootstrap.modelSetup,
      askUserPrompts: bootstrap.askUserPrompts || [],
    });
    publish({
      type: "sessions",
      sessions: bootstrap.sessions || [],
    });
    if (!selectedSessionId || bootstrap.sessionId === selectedSessionId) {
      publish({
        type: "state.snapshot",
        sessionId: bootstrap.sessionId,
        coordination: bootstrap.coordination,
        snapshot: bootstrap.snapshot,
      });
    }
    return bootstrap;
  };

  const refresh = async () => {
    const generation = ++refreshGeneration;
    const bootstrap = await requestGui({ action: "bootstrap" });
    // Network and ownership changes can overlap ordinary market-state polls.
    // A late online bootstrap must not overwrite a newer offline (or
    // replacement-writer) projection and make saved-state controls writable.
    if (generation !== refreshGeneration) return withBrowserState(bootstrap);
    const result = publishBootstrap(bootstrap);
    // A coordinator invalidation can be another tab's preference mutation and
    // the bootstrap payload carries no preferences, so refresh them alongside;
    // an offline or superseded read just keeps the current view.
    void requestGui({ action: "preferences_list" })
      .then((snapshot) => {
        if (generation === refreshGeneration && snapshot) {
          publish({ type: "preferences", ...snapshot });
        }
      })
      .catch(() => {});
    return result;
  };

  const transport = {
    kind: "hosted",
    contractVersion: runtimeTransportContractVersion,
    initialModelSetup: host.getModelSetup?.() || EMPTY_MODEL_SETUP,
    // Export, import, clear, and update flows, bound to this browser runtime by
    // the hosted entrypoint so Settings and the status strip run the same ones.
    hostedData,

    async bootstrap() {
      const bootstrap = withBrowserState(await requestGui({ action: "bootstrap" }));
      selectedSessionId ||= bootstrap.sessionId || "";
      return bootstrap;
    },

    openEventChannel({ onMessage, onClose }) {
      closed = false;
      subscribers.add(onMessage);
      let channelClosed = false;
      const publishOffline = () => {
        publish({
          type: "runtime.status",
          role: "offline",
          coordination: { ownerKind: "offline", writable: false },
          supportsSessionActions: false,
          modelSetup: host.getModelSetup?.() || EMPTY_MODEL_SETUP,
        });
      };
      globalThis.addEventListener?.("offline", publishOffline);
      const unsubscribeHost = host.subscribe?.((message) => {
        if (channelClosed) return;
        if (message?.type === "ask_user.prompt" || message?.type === "ask_user.resolved") {
          publish(message);
          return;
        }
        if (message?.type === "coordination") {
          // A browser can emit an ownership notification while it is already
          // offline (for example after Playwright or the browser network stack
          // cuts connectivity). Never let that stale writer/follower role make
          // persisted market-state controls writable again.
          if (navigator.onLine === false) {
            publishOffline();
            return;
          }
          // Ownership notifications fire while a replacement WebContainer is
          // still restoring its checkpoint. Publishing the local role here is
          // enough to keep the controls usable; issuing an extra bootstrap at
          // the same instant races the action that prompted the handoff (for
          // example, a watchlist Save) for the new runtime's first request.
          const role = host.getRole?.() || "writer";
          const coordination = {
            ownerKind:
              role === "offline" ? "offline" : role === "writer" ? "hosted" : "hosted-follower",
            writable: role !== "offline",
          };
          publish({
            type: "runtime.status",
            role,
            coordination,
            supportsSessionActions: role !== "offline",
            modelSetup: host.getModelSetup?.() || EMPTY_MODEL_SETUP,
          });
          return;
        }
        if (message?.type === "restored-bootstrap") {
          refreshGeneration += 1;
          selectedSessionId = message.bootstrap?.sessionId || selectedSessionId;
          publishBootstrap(message.bootstrap);
          return;
        }
        if (message?.type !== "invalidate") return;
        if (navigator.onLine === false) {
          publishOffline();
          return;
        }
        void refresh().catch((error) => {
          publish({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        });
      });
      const closeChannel = () => {
        if (channelClosed) return;
        channelClosed = true;
        subscribers.delete(onMessage);
        globalThis.removeEventListener?.("offline", publishOffline);
        unsubscribeHost?.();
        onClose?.();
      };
      void transport
        .bootstrap()
        .then((bootstrap) => {
          if (channelClosed) return;
          // The initial bootstrap can complete after the user has already
          // created or opened another session. Never let that stale response
          // move the shared UI back to its original session and erase a
          // direct tool card that has just been projected for the new one.
          const appliesToSelection =
            !selectedSessionId || bootstrap.sessionId === selectedSessionId;
          if (appliesToSelection) selectedSessionId ||= bootstrap.sessionId || "";
          publish({
            type: "boot",
            role: bootstrap.role,
            sessionId: appliesToSelection ? bootstrap.sessionId : selectedSessionId,
            sessionPersisted: bootstrap.sessionPersisted,
            coordination: bootstrap.coordination,
            supportsSessionActions: bootstrap.supportsSessionActions,
            catalog: bootstrap.catalog,
            modelSetup: bootstrap.modelSetup,
            askUserPrompts: bootstrap.askUserPrompts || [],
          });
          publish({
            type: "sessions",
            sessions: bootstrap.sessions || [],
          });
          if (appliesToSelection) {
            publish({
              type: "state.snapshot",
              sessionId: bootstrap.sessionId,
              sessionPersisted: bootstrap.sessionPersisted,
              coordination: bootstrap.coordination,
              snapshot: bootstrap.snapshot,
            });
          }
        })
        .catch((error) => {
          if (channelClosed) return;
          publish({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
          closeChannel();
        });

      return {
        get readyState() {
          return channelClosed ? 3 : 1;
        },
        send(serialized) {
          let command;
          try {
            command = JSON.parse(serialized);
          } catch {
            publish({ type: "error", message: "Hosted GUI command is invalid." });
            return;
          }
          if (command.type === "tool.invoke") {
            void transport
              .invokeTool(command)
              .then((result) => {
                publish({
                  type: "tool.invoke.result",
                  requestId: command.requestId,
                  ok: true,
                  result,
                });
              })
              .catch((error) => {
                publish({
                  type: "tool.invoke.result",
                  requestId: command.requestId,
                  ok: false,
                  error: {
                    message: error instanceof Error ? error.message : String(error),
                  },
                });
              });
            return;
          }
          void Promise.resolve(host.handleCommand?.(command))
            .then(async (result) => {
              if (result?.modelSetup || String(command.type || "").startsWith("model.setup.")) {
                publish({
                  type: "model.setup",
                  modelSetup: host.getModelSetup?.() || result?.modelSetup || EMPTY_MODEL_SETUP,
                });
              }
              await refresh();
            })
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              if (String(command.type || "").startsWith("model.setup.")) {
                publish({
                  type: "model.setup",
                  modelSetup: {
                    ...(host.getModelSetup?.() || EMPTY_MODEL_SETUP),
                    error: message,
                  },
                });
              }
              publish({
                type: "error",
                message,
              });
            });
        },
        close() {
          closeChannel();
        },
      };
    },

    async postCommand(path, body) {
      const commandType = body?.type || GUI_HTTP_COMMAND_TYPES[path];
      await host.handleCommand?.(commandType ? { ...body, type: commandType } : body);
      return refresh();
    },

    async invokeTool(body) {
      // Fresh catalog runs may navigate before the route-triggered load has
      // updated this transport's selection. Keep the returned durable snapshot
      // scoped to the actual tool target instead of the previous home session.
      selectedSessionId = body?.sessionId || selectedSessionId;
      const bootstrap = await requestGui({ action: "tool_invoke", ...body });
      // A direct catalog run persists an actual Pi assistant/tool-result pair.
      // Project that returned durable snapshot immediately: relying only on a
      // later cross-tab invalidation can leave the originating tab without its
      // result card when the notification races or is dropped.
      // Catalog invocation may create a fresh durable Pi session. Its result
      // is authoritative for the route we just navigated to, so adopt that
      // returned session before the stale-bootstrap guard decides whether to
      // project the snapshot. Keeping the previous home session here leaves
      // the new URL rendering the home dashboard until a later reload.
      if (bootstrap?.sessionId) selectedSessionId = bootstrap.sessionId;
      if (bootstrap?.snapshot) publishBootstrap(bootstrap);
      return bootstrap?.result;
    },

    async createSession() {
      const bootstrap = withBrowserState(await requestGui({ action: "new_session" }));
      selectedSessionId = bootstrap.sessionId || selectedSessionId;
      return bootstrap;
    },

    async loadSession(sessionId) {
      const targetSessionId = requireSessionId(sessionId);
      const bootstrap = withBrowserState(
        await requestGui({
          action: "load_session",
          sessionId: targetSessionId,
        }),
      );
      selectedSessionId = bootstrap.sessionId || targetSessionId;
      return bootstrap;
    },

    async startChatRun(sessionId, body, signal) {
      const targetSessionId = requireSessionId(sessionId);
      selectedSessionId = targetSessionId;
      try {
        const response = await host.streamRequest(
          "gui",
          {
            action: "chat_run",
            ...body,
            sessionId: targetSessionId,
          },
          { signal },
        );
        return refreshAfterStream(response, refresh);
      } catch (error) {
        await refreshCanonicalState(refresh);
        if (error?.name === "AbortError") throw error;
        return Response.json(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    },

    getMarketState(signal) {
      return requestGui({ action: "market_state" }, { signal });
    },

    getMarketQuotes(signal) {
      return requestGui({ action: "market_quotes" }, { signal });
    },

    getMarketIndices(signal) {
      return requestGui({ action: "market_indices" }, { signal });
    },

    getInstrumentHistory(symbol, range, signal) {
      return requestGui({ action: "instrument_history", symbol, range }, { signal });
    },

    searchInstruments(query, signal) {
      return requestGui({ action: "instrument_search", query }, { signal });
    },

    getInstrumentQuote(symbol, signal) {
      return requestGui({ action: "instrument_quote", symbol }, { signal });
    },

    getInstrumentEndpoint(endpoint, symbol, signal) {
      return requestGui({ action: "instrument_endpoint", endpoint, symbol }, { signal });
    },

    getPreferences(signal) {
      return requestGui({ action: "preferences_list" }, { signal });
    },

    // Deletes go through the command path so a follower tab follows the same
    // writer coordination every other hosted mutation follows. The refreshed
    // snapshot is published as a preferences event so this tab's shared state
    // view updates without waiting for a refetch.
    async deletePreference({ namespace, key }) {
      const snapshot = await host.handleCommand({ type: "preferences.delete", namespace, key });
      if (snapshot) publish({ type: "preferences", ...snapshot });
      return snapshot;
    },

    async deleteToolDefault({ toolName, paramPath }) {
      const snapshot = await host.handleCommand({
        type: "tool_defaults.delete",
        toolName,
        paramPath,
      });
      if (snapshot) publish({ type: "preferences", ...snapshot });
      return snapshot;
    },

    getDiagnostics(options = {}, signal) {
      return requestGui({ action: "diagnostics", ...options }, { signal });
    },

    dispose() {
      closed = true;
      subscribers.clear();
      host.dispose?.();
    },
  };

  return transport;
}

function refreshAfterStream(response, refresh) {
  if (!response?.body) return response;
  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      let value;
      try {
        value = await reader.read();
      } catch (error) {
        await refreshCanonicalState(refresh);
        controller.error(error);
        return;
      }
      if (!value.done) {
        controller.enqueue(value.value);
        return;
      }
      controller.close();
      await refreshCanonicalState(refresh);
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await refreshCanonicalState(refresh);
      }
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function refreshCanonicalState(refresh) {
  try {
    await refresh();
  } catch {
    // Keep the original stream failure or cancellation as the caller-visible result.
  }
}

function requireSessionId(value) {
  const sessionId = String(value ?? "").trim();
  if (!sessionId) throw new Error("sessionId is required");
  return sessionId;
}
