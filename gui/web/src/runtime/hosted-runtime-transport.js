import { GUI_HTTP_COMMAND_TYPES } from "../../../shared/hosted-gui-protocol.js";
import { runtimeTransportContractVersion } from "./runtime-transport.js";

const EMPTY_CATALOG = { tools: [], workflows: [], providers: [] };
const EMPTY_MODEL_SETUP = {
  requirement: "api_key",
  providers: [],
  availableModels: [],
};
export function createHostedRuntimeTransport({ host }) {
  if (!host || typeof host.request !== "function") {
    throw new Error("Hosted runtime transport requires a browser runtime host");
  }
  if (typeof host.streamRequest !== "function") {
    throw new Error("Hosted runtime transport requires streaming request support");
  }

  const subscribers = new Set();
  let closed = false;
  let selectedSessionId = "";

  const publish = (message) => {
    if (closed) return;
    const serialized = JSON.stringify(message);
    for (const subscriber of subscribers) subscriber(serialized);
  };

  const withBrowserState = (payload) => {
    // A follower receives the writer's bootstrap payload over BroadcastChannel.
    // The payload's role therefore describes the serving tab, not this tab.
    const role = host.getRole?.() || payload?.role || "writer";
    const payloadCoordination = payload?.coordination || {
      ownerKind: role === "offline" ? "offline" : "hosted",
      writable: role === "writer",
    };
    const coordination = {
      ...payloadCoordination,
      writable: role === "writer" && payloadCoordination.writable !== false,
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

  const refresh = async () => {
    const bootstrap = withBrowserState(await requestGui({ action: "bootstrap" }));
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

  const transport = {
    kind: "hosted",
    contractVersion: runtimeTransportContractVersion,
    initialModelSetup: host.getModelSetup?.() || EMPTY_MODEL_SETUP,

    async bootstrap() {
      const bootstrap = withBrowserState(await requestGui({ action: "bootstrap" }));
      selectedSessionId ||= bootstrap.sessionId || "";
      return bootstrap;
    },

    openEventChannel({ onMessage, onClose }) {
      closed = false;
      subscribers.add(onMessage);
      let channelClosed = false;
      const unsubscribeHost = host.subscribe?.((message) => {
        if (channelClosed) return;
        if (message?.type === "ask_user.prompt" || message?.type === "ask_user.resolved") {
          publish(message);
          return;
        }
        if (message?.type !== "invalidate" && message?.type !== "coordination") return;
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
        unsubscribeHost?.();
        onClose?.();
      };
      void transport
        .bootstrap()
        .then((bootstrap) => {
          if (channelClosed) return;
          publish({
            type: "boot",
            role: bootstrap.role,
            sessionId: bootstrap.sessionId,
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
          publish({
            type: "state.snapshot",
            sessionId: bootstrap.sessionId,
            coordination: bootstrap.coordination,
            snapshot: bootstrap.snapshot,
          });
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
      const result = await requestGui({ action: "tool_invoke", ...body });
      await refresh();
      return result?.result;
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
