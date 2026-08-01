import { createBrowserDataStore } from "./browser-data-store.js";

const BRIDGE_CHANNEL = "opencandle-browser-runtime-v1";
const CREDENTIAL_KEY = "opencandle.hosted.credentials.v1";
const PROVIDER_CREDENTIAL_KEY = "opencandle.hosted.provider-credentials.v1";
const CURRENT_SESSION_KEY = "opencandle.hosted.current-session.v1";
const RELAY_CLIENT_KEY = "opencandle.hosted.relay-client.v1";
const REQUEST_TIMEOUT_MS = 180_000;
const PROVIDER_ENV_BY_ID = Object.freeze({
  alpha_vantage: "ALPHA_VANTAGE_API_KEY",
  fred: "FRED_API_KEY",
  finnhub: "FINNHUB_API_KEY",
  brave: "BRAVE_API_KEY",
  exa: "EXA_API_KEY",
  lse: "LSE_API_KEY",
});

export function createBrowserRuntimeHost(options = {}) {
  return new BrowserRuntimeHost(options);
}

class BrowserRuntimeHost {
  constructor(options = {}) {
    this.WebContainerImpl = options.WebContainerImpl;
    this.configureWebContainerApiKey = options.configureWebContainerApiKey;
    this.webContainerApiKey = String(
      options.webContainerApiKey ?? import.meta.env?.VITE_WEBCONTAINER_API_KEY ?? "",
    ).trim();
    this.webContainerApiConfigured = false;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.storage = options.storage ?? globalThis.localStorage;
    this.sessionStorage = options.sessionStorage ?? globalThis.sessionStorage;
    this.relayUrl = hostedRelayUrl(
      options.relayUrl ??
        import.meta.env?.VITE_PROVIDER_RELAY_URL ??
        (globalThis.location?.origin ? `${globalThis.location.origin}/v1/provider-fetch` : ""),
      globalThis.location?.origin,
    );
    this.relayClientId = getOrCreateRelayClientId(this.storage);
    this.dataStore = options.dataStore ?? createBrowserDataStore();
    this.volatileCredential = normalizeCredential(options.sessionCredential);
    this.bridgeFrame =
      options.bridgeFrame ?? document.getElementById("opencandle-runtime-bridge");
    this.container = null;
    this.process = null;
    this.previewOrigin = "";
    this.runtimeEpoch = "";
    this.bootPromise = null;
    this.pendingRequests = new Map();
    this.handleBridgeMessage = this.handleBridgeMessage.bind(this);
    globalThis.addEventListener("message", this.handleBridgeMessage);
  }

  getModelSetup() {
    const credential = this.readCredential();
    const configured = Boolean(credential?.apiKey);
    return {
      requirement: configured ? "ready" : "api_key",
      providers: [
        {
          id: "openai",
          label: "OpenAI",
          envVar: "OPENAI_API_KEY",
          defaultModel: "gpt-4.1-mini",
          signupUrl: "https://platform.openai.com/api-keys",
          authState: configured ? "configured" : "missing",
        },
      ],
      availableModels: configured
        ? [
            {
              provider: "openai",
              id: "gpt-4.1-mini",
              label: "OpenAI GPT-4.1 mini",
            },
          ]
        : [],
      currentModel: configured ? "openai/gpt-4.1-mini" : "",
      storageMode: credential?.storageMode || "persistent",
      supportsAttachments: false,
      hosted: true,
    };
  }

  async handleCommand(command) {
    switch (command?.type) {
      case "model.setup.save_api_key": {
        if (command.provider !== "openai") {
          throw new Error("Hosted OpenCandle currently supports OpenAI model keys only.");
        }
        const apiKey = String(command.apiKey ?? "").trim();
        if (!apiKey || apiKey.length > 512) throw new Error("Enter a valid OpenAI API key.");
        const storageMode = command.storageMode === "session" ? "session" : "persistent";
        this.writeCredential({ apiKey, storageMode });
        await this.request("gui", {
          action: "configure_model",
          provider: "openai",
          modelId: "gpt-4.1-mini",
          apiKey,
        });
        return { modelSetup: this.getModelSetup() };
      }
      case "model.setup.select_model":
      case "model.setup.refresh":
        return { modelSetup: this.getModelSetup() };
      case "provider.save_api_key": {
        const providerId = String(command.providerId ?? "").trim();
        if (!Object.hasOwn(PROVIDER_ENV_BY_ID, providerId)) {
          throw new Error("This provider does not accept an API key in hosted OpenCandle.");
        }
        const apiKey = String(command.apiKey ?? "").trim();
        if (!apiKey || apiKey.length > 8_192) throw new Error("Enter a valid provider API key.");
        const validation = await this.request("gui", {
          action: "validate_provider_key",
          providerId,
          apiKey,
        });
        if (validation?.status === "invalid") {
          throw new Error("The provider rejected this key. Your existing key was not changed.");
        }
        const current = this.readProviderCredentials();
        this.storage.setItem(
          PROVIDER_CREDENTIAL_KEY,
          JSON.stringify({
            version: 1,
            credentials: { ...current, [providerId]: apiKey },
          }),
        );
        await this.stopRuntime();
        if (navigator.onLine) await this.ensureBooted();
        return { saved: true, providerId };
      }
      case "provider.status.check":
        return this.request("gui", { action: "diagnostics" });
      case "hosted.data.export":
        return { archive: await this.dataStore.exportAll() };
      case "hosted.data.import": {
        const archive = String(command.archive ?? "");
        if (this.dataStore.validateImportForRestore) {
          await this.dataStore.validateImportForRestore(archive);
        } else {
          this.dataStore.validateImport(archive);
        }
        await this.stopRuntime();
        const restored = await this.dataStore.importAll(archive);
        if (restored.currentSessionId) {
          this.storage.setItem(CURRENT_SESSION_KEY, restored.currentSessionId);
        } else {
          this.storage.removeItem(CURRENT_SESSION_KEY);
        }
        if (navigator.onLine) await this.ensureBooted();
        return { imported: true };
      }
      case "hosted.data.clear_secrets":
        this.clearSecrets();
        await this.stopRuntime();
        if (navigator.onLine) await this.ensureBooted();
        return { modelSetup: this.getModelSetup() };
      case "hosted.data.clear_all":
        await this.clearAll();
        if (navigator.onLine) await this.ensureBooted();
        return { cleared: true };
      case "hosted.runtime.prepare_update":
        await waitFor(
          () => ![...this.pendingRequests.values()].some((pending) => pending.blocksUpdate),
          REQUEST_TIMEOUT_MS,
          "Wait for active research or saved-state changes to finish before updating.",
        );
        if (navigator.onLine && this.container) {
          await this.request("gui", { action: "bootstrap" });
        }
        await this.dataStore.createBackup();
        return { ready: true };
      case "session.rename":
        return this.request("gui", {
          action: "rename_session",
          sessionId: String(command.path || command.sessionId || ""),
          name: String(command.name || ""),
        });
      case "session.delete":
        return this.request("gui", {
          action: "delete_session",
          sessionId: String(command.path || command.sessionId || ""),
        });
      default:
        throw new Error(
          `This action is unavailable in hosted OpenCandle: ${String(command?.type || "unknown").slice(0, 80)}`,
        );
    }
  }

  async request(operation, payload = {}, options = {}) {
    if (!navigator.onLine) {
      if (operation === "gui" && payload?.action === "bootstrap") {
        const bootstrap = await this.dataStore.readOfflineBootstrap();
        if (!bootstrap) {
          throw new Error("OpenCandle is offline and no saved session is available yet.");
        }
        return {
          ...bootstrap,
          role: "offline",
          offline: true,
          runtimeState: "offline",
          coordination: {
            ...(bootstrap.coordination || {}),
            writable: false,
            ownerKind: "offline",
          },
        };
      }
      throw new Error(
        "OpenCandle is offline. Saved sessions and export remain available, but research needs a network connection.",
      );
    }
    await this.ensureBooted();
    if (!this.previewOrigin || !this.bridgeFrame?.contentWindow) {
      throw new Error("Hosted runtime bridge is unavailable");
    }
    const requestId = randomRequestId();
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const result = await new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error("Hosted runtime request timed out"));
      }, timeoutMs);
      const abort = () => {
        globalThis.clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(new DOMException("The operation was aborted", "AbortError"));
      };
      if (options.signal?.aborted) {
        abort();
        return;
      }
      options.signal?.addEventListener("abort", abort, { once: true });
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timer,
        signal: options.signal,
        abort,
        blocksUpdate: requestBlocksUpdate(operation, payload),
      });
      this.bridgeFrame.contentWindow.postMessage(
        { channel: BRIDGE_CHANNEL, runtimeEpoch: this.runtimeEpoch, operation, requestId, payload },
        this.previewOrigin,
      );
    });
    if (operation === "gui") await this.persistCheckpoint(result);
    if (operation === "gui" && payload?.action === "diagnostics") {
      return {
        ...result,
        networkState: navigator.onLine ? "online" : "offline",
        writerState: this.pendingRequests.size > 0 ? "busy" : "idle",
      };
    }
    return result;
  }

  async streamRequest(operation, payload = {}, options = {}) {
    if (!navigator.onLine) {
      throw new Error("OpenCandle is offline. Research needs a network connection.");
    }
    await this.ensureBooted();
    if (!this.previewOrigin || !this.bridgeFrame?.contentWindow) {
      throw new Error("Hosted runtime bridge is unavailable");
    }
    const requestId = randomRequestId();
    let streamController;
    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
    });
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const timer = globalThis.setTimeout(() => {
      this.pendingRequests.delete(requestId);
      streamController.error(new Error("Hosted runtime stream timed out"));
      this.bridgeFrame?.contentWindow?.postMessage(
        { channel: BRIDGE_CHANNEL, runtimeEpoch: this.runtimeEpoch, type: "cancel", requestId },
        this.previewOrigin,
      );
    }, timeoutMs);
    const abort = () => {
      globalThis.clearTimeout(timer);
      this.pendingRequests.delete(requestId);
      this.bridgeFrame?.contentWindow?.postMessage(
        { channel: BRIDGE_CHANNEL, runtimeEpoch: this.runtimeEpoch, type: "cancel", requestId },
        this.previewOrigin,
      );
      streamController.error(new DOMException("The operation was aborted", "AbortError"));
    };
    if (options.signal?.aborted) abort();
    else {
      options.signal?.addEventListener("abort", abort, { once: true });
      this.pendingRequests.set(requestId, {
        streamController,
        sseGate: createDurableSseGate(streamController),
        timer,
        signal: options.signal,
        abort,
        blocksUpdate: true,
      });
      this.bridgeFrame.contentWindow.postMessage(
        {
          channel: BRIDGE_CHANNEL,
          runtimeEpoch: this.runtimeEpoch,
          operation: `${operation}-stream`,
          requestId,
          payload,
        },
        this.previewOrigin,
      );
    }
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  async dispose() {
    globalThis.removeEventListener("message", this.handleBridgeMessage);
    await this.stopRuntime();
  }

  async ensureBooted() {
    this.bootPromise ??= this.boot();
    try {
      await this.bootPromise;
    } catch (error) {
      this.bootPromise = null;
      throw error;
    }
  }

  async boot() {
    let WebContainerImpl = this.WebContainerImpl;
    let configureWebContainerApiKey = this.configureWebContainerApiKey;
    if (!WebContainerImpl || (this.webContainerApiKey && !configureWebContainerApiKey)) {
      const webContainerApi = await import("@webcontainer/api");
      WebContainerImpl ??= webContainerApi.WebContainer;
      configureWebContainerApiKey ??= webContainerApi.configureAPIKey;
    }
    if (this.webContainerApiKey && !this.webContainerApiConfigured) {
      configureWebContainerApiKey(this.webContainerApiKey);
      this.webContainerApiConfigured = true;
    }
    const container = await WebContainerImpl.boot({ coep: "require-corp" });
    this.container = container;
    const [runtimeBundle, sqlWasm, sqlCommonJs, persisted] = await Promise.all([
      this.fetchAssetText(
        `/runtime/runtime-bundle.mjs?v=${encodeURIComponent(__OPENCANDLE_RUNTIME_VERSION__)}`,
      ),
      this.fetchAssetBytes("/runtime/sql-wasm.wasm"),
      this.fetchAssetText("/runtime/sql-wasm.cjs"),
      this.dataStore.readRuntimeSnapshot(),
    ]);
    const { sessions: sessionFiles, stateBytes, currentSessionId } = persisted;
    if (stateBytes) await this.dataStore.createBackup();
    const runtimeFiles = {
      "runtime-bundle.mjs": { file: { contents: runtimeBundle } },
      "package.json": { file: { contents: '{"type":"module","private":true}' } },
      "sql-wasm.cjs": { file: { contents: sqlCommonJs } },
      "sql-wasm.wasm": { file: { contents: sqlWasm } },
    };
    if (sessionFiles.length > 0) {
      runtimeFiles.sessions = {
        directory: Object.fromEntries(
          sessionFiles.map((session) => [
            session.filename,
            { file: { contents: session.content } },
          ]),
        ),
      };
    }
    if (stateBytes) {
      runtimeFiles.state = {
        directory: {
          "current.sqlite3": { file: { contents: stateBytes } },
        },
      };
    }
    await container.mount(runtimeFiles);

    await this.startProcess(container, currentSessionId || this.storage.getItem(CURRENT_SESSION_KEY) || "");
  }

  async startProcess(container, currentSessionId = "") {
    const port = 10_000 + Math.floor(Math.random() * 40_000);
    this.runtimeEpoch = randomRequestId();
    const credential = this.readCredential();
    const providerCredentials = this.readProviderCredentials();
    const environment = {
      PORT: String(port),
      OPENCANDLE_SPIKE_HOST_ORIGIN: globalThis.location.origin,
      OPENCANDLE_RUNTIME_EPOCH: this.runtimeEpoch,
      ...(this.relayUrl
        ? {
            OPENCANDLE_PROVIDER_RELAY_URL: this.relayUrl,
            OPENCANDLE_PROVIDER_RELAY_CLIENT_ID: this.relayClientId,
          }
        : {}),
      ...(credential?.apiKey ? { OPENAI_API_KEY: credential.apiKey } : {}),
      ...Object.fromEntries(
        Object.entries(providerCredentials).map(([providerId, apiKey]) => [
          PROVIDER_ENV_BY_ID[providerId],
          apiKey,
        ]),
      ),
      ...(currentSessionId
        ? {
            OPENCANDLE_CURRENT_SESSION_ID: currentSessionId,
          }
        : {}),
    };
    const serverReady = new Promise((resolve) => {
      const unsubscribe = container.on("server-ready", (readyPort, url) => {
        if (readyPort !== port) return;
        unsubscribe?.();
        resolve(url);
      });
    });
    this.process = await container.spawn("node", ["runtime-bundle.mjs"], {
      env: environment,
      output: false,
    });
    const previewUrl = await withTimeout(
      serverReady,
      90_000,
      "Hosted runtime did not become ready",
    );
    await this.connectBridge(previewUrl);
  }

  async stopRuntime() {
    await this.stopProcess();
    await this.container?.teardown?.();
    this.container = null;
    this.bootPromise = null;
  }

  async stopProcess() {
    for (const [requestId, pending] of this.pendingRequests) {
      globalThis.clearTimeout(pending.timer);
      pending.signal?.removeEventListener("abort", pending.abort);
      if (pending.streamController) {
        pending.streamController.error(new Error("Hosted runtime restarted"));
      } else {
        pending.reject(new Error("Hosted runtime restarted"));
      }
      this.pendingRequests.delete(requestId);
    }
    this.process?.kill();
    this.process = null;
    this.previewOrigin = "";
    this.runtimeEpoch = "";
    this.bridgeFrame?.removeAttribute("src");
  }

  async connectBridge(previewUrl) {
    if (!this.bridgeFrame) throw new Error("Hosted runtime bridge frame is missing");
    const previewOrigin = new URL(previewUrl).origin;
    this.previewOrigin = previewOrigin;
    const ready = new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(
        () => reject(new Error("Hosted runtime bridge did not become ready")),
        30_000,
      );
      this.bridgeReady = {
        resolve: () => {
          globalThis.clearTimeout(timer);
          resolve();
        },
        reject,
      };
    });
    this.bridgeFrame.src = `${previewOrigin}/bridge`;
    await ready;
  }

  handleBridgeMessage(event) {
    if (
      !this.previewOrigin ||
      event.origin !== this.previewOrigin ||
      event.source !== this.bridgeFrame?.contentWindow
    ) {
      return;
    }
    const message = event.data;
    if (
      !message ||
      typeof message !== "object" ||
      message.channel !== BRIDGE_CHANNEL ||
      message.runtimeEpoch !== this.runtimeEpoch
    ) return;
    if (message.type === "ready") {
      this.bridgeReady?.resolve();
      this.bridgeReady = null;
      return;
    }
    if (message.type === "stream-chunk" && typeof message.requestId === "string") {
      const pending = this.pendingRequests.get(message.requestId);
      if (!pending?.streamController || !isByteArray(message.value)) return;
      pending.sseGate.push(Uint8Array.from(message.value));
      return;
    }
    if (message.type === "stream-end" && typeof message.requestId === "string") {
      void this.finishStreamRequest(message.requestId, message);
      return;
    }
    if (message.type !== "response" || typeof message.requestId !== "string") return;
    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) return;
    globalThis.clearTimeout(pending.timer);
    pending.signal?.removeEventListener("abort", pending.abort);
    this.pendingRequests.delete(message.requestId);
    if (message.ok) {
      pending.resolve(message.result);
      return;
    }
    pending.reject(
      new Error(
        String(message.result?.error || message.error || "Hosted runtime request failed").slice(
          0,
          500,
        ),
      ),
    );
  }

  async finishStreamRequest(requestId, message) {
    const pending = this.pendingRequests.get(requestId);
    if (!pending?.streamController) return;
    globalThis.clearTimeout(pending.timer);
    pending.signal?.removeEventListener("abort", pending.abort);
    this.pendingRequests.delete(requestId);
    if (!message.ok) {
      pending.sseGate.discardCompletion();
      pending.streamController.error(
        new Error(String(message.error || "Hosted runtime stream failed").slice(0, 500)),
      );
      return;
    }
    try {
      pending.sseGate.finishInput();
      await this.request("gui", { action: "bootstrap" });
      pending.sseGate.releaseCompletion();
      pending.streamController.close();
    } catch (error) {
      pending.sseGate.discardCompletion();
      pending.streamController.error(error);
    }
  }

  readCredential() {
    if (this.volatileCredential) return this.volatileCredential;
    const session = parseCredential(this.sessionStorage.getItem(CREDENTIAL_KEY));
    if (session) return session;
    return parseCredential(this.storage.getItem(CREDENTIAL_KEY));
  }

  writeCredential(credential) {
    this.storage.removeItem(CREDENTIAL_KEY);
    this.sessionStorage.removeItem(CREDENTIAL_KEY);
    this.volatileCredential = credential.storageMode === "session" ? normalizeCredential(credential) : null;
    const target = credential.storageMode === "session" ? this.sessionStorage : this.storage;
    target.setItem(
      CREDENTIAL_KEY,
      JSON.stringify({
        version: 1,
        provider: "openai",
        modelId: "gpt-4.1-mini",
        apiKey: credential.apiKey,
        storageMode: credential.storageMode,
      }),
    );
  }

  async persistCheckpoint(value) {
    await this.dataStore.persistCheckpoint(value);
    if (typeof value.sessionId === "string") {
      this.storage.setItem(CURRENT_SESSION_KEY, value.sessionId);
    }
  }

  clearSecrets() {
    this.volatileCredential = null;
    this.storage.removeItem(CREDENTIAL_KEY);
    this.sessionStorage.removeItem(CREDENTIAL_KEY);
    this.storage.removeItem(PROVIDER_CREDENTIAL_KEY);
  }

  readProviderCredentials() {
    return parseProviderCredentials(this.storage.getItem(PROVIDER_CREDENTIAL_KEY));
  }

  getSessionCredential() {
    const credential = this.readCredential();
    return credential?.storageMode === "session" ? { ...credential } : null;
  }

  async clearAll() {
    await this.stopRuntime();
    await this.dataStore.clearAll();
    this.clearSecrets();
    this.storage.removeItem(CURRENT_SESSION_KEY);
    if (globalThis.caches) {
      await Promise.all((await caches.keys()).map((name) => caches.delete(name)));
    }
  }

  async fetchAssetBytes(path) {
    const response = await this.fetchImpl(path, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Hosted runtime asset is unavailable: ${path}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async fetchAssetText(path) {
    const response = await this.fetchImpl(path, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Hosted runtime asset is unavailable: ${path}`);
    return response.text();
  }
}

function hostedRelayUrl(value, hostOrigin) {
  const candidate = String(value ?? "").trim();
  const origin = String(hostOrigin ?? "").trim();
  if (!candidate || !origin) return "";
  try {
    const target = new URL(candidate, origin);
    const host = new URL(origin);
    if (target.origin === host.origin) return target.href;
    if (isLoopback(target) && isLoopback(host)) return target.href;
    return "";
  } catch {
    return "";
  }
}

function isLoopback(url) {
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost")
  );
}

function getOrCreateRelayClientId(storage) {
  const existing = storage.getItem(RELAY_CLIENT_KEY) ?? "";
  if (/^[a-f0-9]{32}$/.test(existing)) return existing;
  const value = crypto.randomUUID().replaceAll("-", "");
  storage.setItem(RELAY_CLIENT_KEY, value);
  return value;
}

export function createDurableSseGate(controller) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const completionBlocks = [];

  const emitCompleteBlocks = () => {
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const framed = `${block}\n\n`;
      if (isRunCompletedBlock(block)) completionBlocks.push(framed);
      else controller.enqueue(encoder.encode(framed));
      boundary = buffer.indexOf("\n\n");
    }
  };

  return {
    push(bytes) {
      buffer += decoder.decode(bytes, { stream: true });
      emitCompleteBlocks();
    },
    finishInput() {
      buffer += decoder.decode();
      emitCompleteBlocks();
      if (buffer) {
        controller.enqueue(encoder.encode(buffer));
        buffer = "";
      }
    },
    releaseCompletion() {
      for (const block of completionBlocks.splice(0)) controller.enqueue(encoder.encode(block));
    },
    discardCompletion() {
      completionBlocks.length = 0;
      buffer = "";
    },
  };
}

function isRunCompletedBlock(block) {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data) return false;
  try {
    return JSON.parse(data)?.type === "run.completed";
  } catch {
    return false;
  }
}

function parseCredential(serialized) {
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized);
    if (
      value?.version !== 1 ||
      value.provider !== "openai" ||
      value.modelId !== "gpt-4.1-mini" ||
      typeof value.apiKey !== "string" ||
      !value.apiKey.trim() ||
      (value.storageMode !== "persistent" && value.storageMode !== "session")
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function parseProviderCredentials(serialized) {
  if (!serialized) return {};
  try {
    const value = JSON.parse(serialized);
    if (value?.version !== 1 || !value.credentials || typeof value.credentials !== "object") {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value.credentials).filter(
        ([providerId, apiKey]) =>
          Object.hasOwn(PROVIDER_ENV_BY_ID, providerId) &&
          typeof apiKey === "string" &&
          apiKey.trim().length > 0 &&
          apiKey.length <= 8_192,
      ),
    );
  } catch {
    return {};
  }
}

function normalizeCredential(value) {
  if (
    value?.version !== 1 ||
    value.provider !== "openai" ||
    value.modelId !== "gpt-4.1-mini" ||
    typeof value.apiKey !== "string" ||
    !value.apiKey.trim() ||
    value.storageMode !== "session"
  ) {
    return null;
  }
  return { ...value, apiKey: value.apiKey.trim() };
}

function randomRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isByteArray(value) {
  return (
    Array.isArray(value) &&
    value.length <= 131_072 &&
    value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  );
}

const UPDATE_SAFE_GUI_ACTIONS = new Set([
  "bootstrap",
  "get",
  "market_state",
  "market_quotes",
  "market_indices",
  "instrument_history",
  "instrument_search",
  "instrument_quote",
  "instrument_endpoint",
  "diagnostics",
]);

function requestBlocksUpdate(operation, payload) {
  return operation !== "gui" || !UPDATE_SAFE_GUI_ACTIONS.has(payload?.action);
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = globalThis.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function waitFor(predicate, timeoutMs, message) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
