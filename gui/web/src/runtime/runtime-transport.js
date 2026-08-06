export const runtimeTransportContractVersion = 1;

export function actionSurfaceRole(role, supportsSessionActions) {
  if (supportsSessionActions) return "writer";
  // A hosted tab may retain its last elected role while the runtime switches
  // to offline state. Never let that stale writer label re-enable mutations.
  return role === "writer" ? "offline" : role;
}

export function createLoopbackRuntimeTransport(options = {}) {
  const fetchImpl = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
  const runtimeLocation = options.location ?? globalThis.location;

  const readJson = async (response) => {
    let data;
    try {
      data = await response.json();
    } catch {
      if (response.ok) throw new Error("Runtime returned an invalid JSON response");
      data = {};
    }
    if (!response.ok) throw new Error(data?.error || response.statusText || "Request failed");
    return data;
  };

  const postJson = async (path, body, signal) => {
    const response = await fetchImpl(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    return readJson(response);
  };

  return {
    kind: "loopback",
    contractVersion: runtimeTransportContractVersion,

    async bootstrap() {
      return readJson(await fetchImpl("/api/bootstrap"));
    },

    async getJson(path, signal) {
      return readJson(await (signal ? fetchImpl(path, { signal }) : fetchImpl(path)));
    },

    openEventChannel({ onMessage, onClose }) {
      if (typeof WebSocketImpl !== "function") return null;
      const protocol = runtimeLocation?.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocketImpl(`${protocol}//${runtimeLocation?.host}/ws`);
      socket.onmessage = (event) => onMessage(event.data);
      socket.onclose = () => onClose();
      return {
        get readyState() {
          return socket.readyState;
        },
        send(message) {
          socket.send(message);
        },
        close() {
          socket.close();
        },
      };
    },

    postCommand(path, body) {
      return postJson(path, body);
    },

    invokeTool(body) {
      return postJson("/api/tool-invoke", body).then((data) => data.result);
    },

    async createSession() {
      return readJson(await fetchImpl("/api/session/new", { method: "POST" }));
    },

    async loadSession(sessionId) {
      const encoded = encodeURIComponent(String(sessionId ?? "").trim());
      if (!encoded) throw new Error("sessionId is required");
      return readJson(await fetchImpl(`/api/sessions/${encoded}/bootstrap`));
    },

    startChatRun(sessionId, body, signal) {
      const encoded = encodeURIComponent(String(sessionId ?? "").trim());
      if (!encoded) throw new Error("sessionId is required");
      return fetchImpl(`/api/sessions/${encoded}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    },

    getMarketState(signal) {
      return this.getJson("/api/market-state", signal);
    },

    getMarketQuotes(signal) {
      return this.getJson("/api/market-state/quotes", signal);
    },

    getMarketIndices(signal) {
      return this.getJson("/api/market-state/indices", signal);
    },

    getInstrumentHistory(symbol, range, signal) {
      return this.getJson(
        `/api/instruments/history?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`,
        signal,
      );
    },

    searchInstruments(query, signal) {
      return this.getJson(
        `/api/instruments/search?q=${encodeURIComponent(String(query ?? "").trim())}`,
        signal,
      );
    },

    getInstrumentQuote(symbol, signal) {
      return this.getJson(
        `/api/instruments/quote?symbol=${encodeURIComponent(String(symbol ?? "").trim())}`,
        signal,
      );
    },

    getInstrumentEndpoint(endpoint, symbol, signal) {
      return this.getJson(
        `/api/instruments/${encodeURIComponent(endpoint)}?symbol=${encodeURIComponent(symbol)}`,
        signal,
      );
    },

    getPreferences(signal) {
      return this.getJson("/api/preferences", signal);
    },

    deletePreference({ namespace, key }) {
      return postJson("/api/preferences/delete", { namespace, key });
    },

    deleteToolDefault({ toolName, paramPath }) {
      return postJson("/api/tool-defaults/delete", { toolName, paramPath });
    },

    getDiagnostics({ sessions = false } = {}, signal) {
      return this.getJson(sessions ? "/api/doctor?sessions=1" : "/api/doctor", signal);
    },
  };
}

export const loopbackRuntimeTransport = createLoopbackRuntimeTransport();
