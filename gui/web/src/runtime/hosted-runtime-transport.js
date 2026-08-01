import { runtimeTransportContractVersion } from "./runtime-transport.js";

const EMPTY_CATALOG = { tools: [], workflows: [], providers: [] };
const EMPTY_MODEL_SETUP = {
  requirement: "api_key",
  providers: [],
  availableModels: [],
};
const HTTP_FALLBACK_COMMAND_TYPES = {
  "/api/model-setup/refresh": "model.setup.refresh",
  "/api/model-setup/api-key": "model.setup.save_api_key",
  "/api/model-setup/model": "model.setup.select_model",
  "/api/provider-setup/api-key": "provider.save_api_key",
};

export function createHostedRuntimeTransport({ host }) {
  if (!host || typeof host.request !== "function") {
    throw new Error("Hosted runtime transport requires a browser runtime host");
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
    const role = payload?.role || "writer";
    return {
      ...payload,
      role,
      coordination: payload?.coordination || {
        ownerKind: role === "offline" ? "offline" : "hosted",
        writable: role !== "offline",
      },
      catalog: payload?.catalog || EMPTY_CATALOG,
      modelSetup: host.getModelSetup?.() || payload?.modelSetup || EMPTY_MODEL_SETUP,
      supportsSessionActions: payload?.supportsSessionActions !== false,
    };
  };

  const requestGui = (payload, options) => host.request("gui", payload, options);

  const refresh = async () => {
    const bootstrap = withBrowserState(await requestGui({ action: "bootstrap" }));
    publish({
      type: "runtime.status",
      role: bootstrap.role,
      coordination: bootstrap.coordination,
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
      void transport
        .bootstrap()
        .then((bootstrap) => {
          if (channelClosed) return;
          publish({
            type: "boot",
            role: bootstrap.role,
            sessionId: bootstrap.sessionId,
            coordination: bootstrap.coordination,
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
              publish({
                type: "error",
                message: error instanceof Error ? error.message : String(error),
              });
            });
        },
        close() {
          if (channelClosed) return;
          channelClosed = true;
          subscribers.delete(onMessage);
          unsubscribeHost?.();
          onClose?.();
        },
      };
    },

    async postCommand(path, body) {
      const commandType = body?.type || HTTP_FALLBACK_COMMAND_TYPES[path];
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
        if (typeof host.streamRequest === "function") {
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
        }
        const result = await requestGui(
          {
            action: "chat_run",
            ...body,
            sessionId: targetSessionId,
          },
          { signal },
        );
        queueMicrotask(() => {
          void refresh();
        });
        return sseResponse(Array.isArray(result?.events) ? result.events : []);
      } catch (error) {
        await refreshCanonicalState(refresh);
        if (error?.name === "AbortError") throw error;
        return Response.json(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    },

    getJson(path, signal) {
      return requestGui({ action: "get", path }, { signal });
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

function sseResponse(events) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
