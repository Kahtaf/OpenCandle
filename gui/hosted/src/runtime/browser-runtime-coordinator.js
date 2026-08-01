const CHANNEL_NAME = "opencandle-hosted-coordination-v1";
const LOCK_NAME = "opencandle-hosted-writer-v1";
const EPOCH_KEY = "opencandle.hosted.runtime-epoch.v1";
const CREDENTIAL_KEY = "opencandle.hosted.credentials.v1";
const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;
const MAX_FORWARDED_CHUNK_BYTES = 64 * 1024;

export function createBrowserRuntimeCoordinator(options) {
  return new BrowserRuntimeCoordinator(options);
}

class BrowserRuntimeCoordinator {
  constructor(options = {}) {
    if (typeof options.createHost !== "function") {
      throw new Error("Browser runtime coordinator requires a host factory");
    }
    this.createHost = options.createHost;
    this.lockManager = options.lockManager ?? navigator.locks;
    this.channel = (options.channelFactory ?? ((name) => new BroadcastChannel(name)))(CHANNEL_NAME);
    this.storage = options.storage ?? localStorage;
    this.sessionStorage = options.sessionStorage ?? globalThis.sessionStorage;
    this.eventTarget = options.eventTarget ?? globalThis;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.tabId = randomId();
    this.role = "candidate";
    this.epoch = 0;
    this.writerId = "";
    this.host = null;
    this.cachedModelSetup = null;
    this.sessionCredential = null;
    this.pending = new Map();
    this.completed = new Map();
    this.activeForwardedStreams = new Map();
    this.subscribers = new Set();
    this.disposed = false;
    this.releaseWriter = null;
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.channel.onmessage = (event) => this.handleMessage(event.data);
    this.handleNetworkChange = () =>
      this.notify({ type: "invalidate", reason: "network", epoch: this.epoch });
    this.eventTarget.addEventListener?.("online", this.handleNetworkChange);
    this.eventTarget.addEventListener?.("offline", this.handleNetworkChange);
    this.writerLockPromise = this.lockManager.request(LOCK_NAME, async () => {
      if (this.disposed) return;
      await this.becomeWriter();
      await new Promise((resolve) => {
        this.releaseWriter = resolve;
      });
      await this.stopWriter();
    });
    void this.writerLockPromise.catch((error) => this.rejectReady(error));
    this.post({ type: "hello" });
  }

  ready() {
    return this.readyPromise;
  }

  getRole() {
    return this.role;
  }

  getEpoch() {
    return this.epoch;
  }

  getModelSetup() {
    return this.host?.getModelSetup?.() ?? this.cachedModelSetup ?? {
      requirement: "api_key",
      providers: modelSetupProviders.map((provider) => ({ ...provider, authState: "missing" })),
      availableModels: [],
      hosted: true,
    };
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  async request(operation, payload = {}, options = {}) {
    await this.ready();
    if (this.disposed) throw new Error("Hosted runtime coordinator is closed");
    if (this.role === "writer") {
      const value = await this.host.request(operation, payload, options);
      if (isMutatingRequest(operation, payload)) this.broadcastInvalidation();
      return this.decorate(value);
    }
    return this.forward({ kind: "request", operation, payload }, options.signal);
  }

  async handleCommand(command) {
    await this.ready();
    if (this.role === "writer") {
      const value = await this.host.handleCommand(command);
      this.cachedModelSetup = this.host.getModelSetup?.() ?? this.cachedModelSetup;
      this.captureAndBroadcastSessionCredential();
      this.broadcastStatus();
      this.broadcastInvalidation();
      return value;
    }
    return this.forward({ kind: "command", command });
  }

  async streamRequest(operation, payload = {}, options = {}) {
    await this.ready();
    if (this.role === "writer") {
      const response = await this.host.streamRequest(operation, payload, options);
      return this.wrapWriterStream(response);
    }
    return this.forwardStream({ operation, payload }, options.signal);
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const controller of this.activeForwardedStreams.values()) controller.abort();
    this.activeForwardedStreams.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      if (pending.streamController) {
        pending.streamController.error(new Error("Hosted runtime coordinator closed"));
      } else {
        pending.reject(new Error("Hosted runtime coordinator closed"));
      }
    }
    this.pending.clear();
    this.eventTarget.removeEventListener?.("online", this.handleNetworkChange);
    this.eventTarget.removeEventListener?.("offline", this.handleNetworkChange);
    const heldWriterLock = typeof this.releaseWriter === "function";
    this.releaseWriter?.();
    if (heldWriterLock) await this.writerLockPromise;
    else await this.stopWriter();
    this.channel.close();
  }

  async becomeWriter() {
    const previous = Number.parseInt(this.storage.getItem(EPOCH_KEY) ?? "0", 10);
    const nextEpoch = Number.isSafeInteger(previous) && previous >= 0 ? previous + 1 : 1;
    if (nextEpoch !== this.epoch) this.rejectPendingForWriterChange();
    this.epoch = nextEpoch;
    this.storage.setItem(EPOCH_KEY, String(this.epoch));
    this.writerId = this.tabId;
    this.role = "writer";
    this.host = this.createHost({ sessionCredential: this.sessionCredential });
    this.cachedModelSetup = this.host.getModelSetup?.() ?? null;
    this.resolveReady();
    this.broadcastStatus();
    this.notify({ type: "coordination", role: this.role, epoch: this.epoch });
  }

  async stopWriter() {
    const host = this.host;
    this.host = null;
    this.releaseWriter = null;
    if (host) await host.dispose?.();
  }

  forward(payload, signal) {
    const requestId = randomId();
    return new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new DOMException("The operation was aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("The active hosted tab did not respond"));
      }, this.requestTimeoutMs);
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(requestId, { resolve, reject, timer, signal, abort });
      this.post({
        type: "request",
        epoch: this.epoch,
        requestId,
        target: this.writerId,
        ...payload,
      });
    });
  }

  forwardStream(payload, signal) {
    const requestId = randomId();
    let streamController;
    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
    });
    const timer = setTimeout(() => {
      this.pending.delete(requestId);
      streamController.error(new Error("The active hosted tab did not start the stream"));
    }, this.requestTimeoutMs);
    const abort = () => {
      clearTimeout(timer);
      this.pending.delete(requestId);
      this.post({ type: "cancel", epoch: this.epoch, requestId, target: this.writerId });
      streamController.error(new DOMException("The operation was aborted", "AbortError"));
    };
    if (signal?.aborted) abort();
    else {
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(requestId, { streamController, timer, signal, abort });
      this.post({
        type: "request",
        epoch: this.epoch,
        requestId,
        target: this.writerId,
        kind: "stream",
        ...payload,
      });
    }
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  handleMessage(message) {
    if (!isMessage(message) || message.from === this.tabId || this.disposed) return;
    if (message.type === "hello") {
      if (this.role === "writer") {
        this.broadcastStatus();
        this.captureAndBroadcastSessionCredential(message.from);
      }
      return;
    }
    if (message.type === "writer-status") {
      if (!isEpoch(message.epoch) || message.epoch < this.epoch) return;
      if (this.role !== "writer") {
        if (message.epoch !== this.epoch || (this.writerId && message.writerId !== this.writerId)) {
          this.rejectPendingForWriterChange();
        }
        this.epoch = message.epoch;
        this.writerId = message.writerId;
        this.role = "follower";
        this.cachedModelSetup = message.modelSetup ?? this.cachedModelSetup;
        this.resolveReady();
        this.notify({ type: "coordination", role: this.role, epoch: this.epoch });
      }
      return;
    }
    if (!isEpoch(message.epoch) || message.epoch !== this.epoch) return;
    if (message.type === "session-credential") {
      if (message.target && message.target !== this.tabId) return;
      this.sessionCredential = normalizeSessionCredential(message.credential);
      if (!this.sessionCredential) this.sessionStorage?.removeItem(CREDENTIAL_KEY);
      return;
    }
    if (message.type === "cancel") {
      if (this.role === "writer" && message.target === this.tabId) {
        this.activeForwardedStreams.get(message.requestId)?.abort();
      }
      return;
    }
    if (message.type === "request") {
      if (this.role === "writer" && (!message.target || message.target === this.tabId)) {
        void this.handleForwardedRequest(message);
      }
      return;
    }
    if (message.type === "response") {
      if (message.target !== this.tabId || typeof message.requestId !== "string") return;
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      pending.signal?.removeEventListener("abort", pending.abort);
      this.pending.delete(message.requestId);
      if (message.ok) pending.resolve(this.decorate(message.value));
      else pending.reject(new Error(String(message.error || "Hosted writer action failed").slice(0, 500)));
      return;
    }
    if (message.type === "stream-chunk" || message.type === "stream-end") {
      if (message.target !== this.tabId || typeof message.requestId !== "string") return;
      const pending = this.pending.get(message.requestId);
      if (!pending?.streamController) return;
      if (message.type === "stream-chunk") {
        if (isByteArray(message.value)) {
          clearTimeout(pending.timer);
          pending.timer = null;
          pending.streamController.enqueue(Uint8Array.from(message.value));
        }
        return;
      }
      clearTimeout(pending.timer);
      pending.signal?.removeEventListener("abort", pending.abort);
      this.pending.delete(message.requestId);
      if (message.ok) pending.streamController.close();
      else pending.streamController.error(new Error(String(message.error || "Hosted stream failed").slice(0, 500)));
      return;
    }
    if (message.type === "invalidate") this.notify({ type: "invalidate", epoch: this.epoch });
  }

  async handleForwardedRequest(message) {
    if (typeof message.requestId !== "string" || typeof message.from !== "string") return;
    if (message.kind === "stream") {
      await this.handleForwardedStream(message);
      return;
    }
    let operation = this.completed.get(message.requestId);
    if (!operation) {
      operation = (async () => {
        if (message.kind === "command") return this.host.handleCommand(message.command);
        if (message.kind === "request" && typeof message.operation === "string") {
          return this.host.request(message.operation, message.payload ?? {});
        }
        throw new Error("Hosted follower action is invalid");
      })();
      this.completed.set(message.requestId, operation);
      if (this.completed.size > 256) this.completed.delete(this.completed.keys().next().value);
    }
    try {
      const value = await operation;
      this.cachedModelSetup = this.host.getModelSetup?.() ?? this.cachedModelSetup;
      this.captureAndBroadcastSessionCredential();
      this.post({
        type: "response",
        epoch: this.epoch,
        requestId: message.requestId,
        target: message.from,
        ok: true,
        value,
      });
      this.broadcastStatus();
      this.broadcastInvalidation();
    } catch (error) {
      this.post({
        type: "response",
        epoch: this.epoch,
        requestId: message.requestId,
        target: message.from,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleForwardedStream(message) {
    const controller = new AbortController();
    this.activeForwardedStreams.set(message.requestId, controller);
    try {
      const response = await this.host.streamRequest(
        message.operation,
        message.payload ?? {},
        { signal: controller.signal },
      );
      if (!response.ok || !response.body) throw new Error("Hosted writer could not start the stream");
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (let offset = 0; offset < value.byteLength; offset += MAX_FORWARDED_CHUNK_BYTES) {
          this.post({
            type: "stream-chunk",
            epoch: this.epoch,
            requestId: message.requestId,
            target: message.from,
            value: Array.from(value.subarray(offset, offset + MAX_FORWARDED_CHUNK_BYTES)),
          });
        }
      }
      this.post({
        type: "stream-end",
        epoch: this.epoch,
        requestId: message.requestId,
        target: message.from,
        ok: true,
      });
      this.broadcastInvalidation();
    } catch (error) {
      this.post({
        type: "stream-end",
        epoch: this.epoch,
        requestId: message.requestId,
        target: message.from,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.activeForwardedStreams.delete(message.requestId);
    }
  }

  wrapWriterStream(response) {
    if (!response.body) return response;
    const reader = response.body.getReader();
    const self = this;
    return new Response(
      new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              self.broadcastInvalidation();
              controller.close();
            } else {
              controller.enqueue(value);
            }
          } catch (error) {
            controller.error(error);
          }
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      }),
      { status: response.status, statusText: response.statusText, headers: response.headers },
    );
  }

  broadcastStatus() {
    if (this.role !== "writer") return;
    this.post({
      type: "writer-status",
      epoch: this.epoch,
      writerId: this.tabId,
      modelSetup: this.getModelSetup(),
    });
  }

  captureAndBroadcastSessionCredential(target) {
    if (this.role !== "writer") return;
    this.sessionCredential = normalizeSessionCredential(this.host?.getSessionCredential?.());
    this.post({
      type: "session-credential",
      epoch: this.epoch,
      ...(target ? { target } : {}),
      credential: this.sessionCredential,
    });
  }

  rejectPendingForWriterChange() {
    const error = new Error(
      "The hosted writer changed before the action completed. Check the current state, then retry.",
    );
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.signal?.removeEventListener("abort", pending.abort);
      if (pending.streamController) pending.streamController.error(error);
      else pending.reject(error);
      this.pending.delete(requestId);
    }
  }

  broadcastInvalidation() {
    this.post({ type: "invalidate", epoch: this.epoch });
    this.notify({ type: "invalidate", epoch: this.epoch });
  }

  decorate(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    if (!Array.isArray(value.sessions) || !value.snapshot) return value;
    const offline = value.role === "offline";
    return {
      ...value,
      role: offline ? "offline" : this.role,
      runtimeEpoch: this.epoch,
      coordination: {
        ...(value.coordination || {}),
        ownerKind: offline
          ? "offline"
          : this.role === "writer"
            ? "hosted"
            : "hosted-follower",
        writable: !offline,
        runtimeEpoch: this.epoch,
      },
    };
  }

  notify(message) {
    for (const listener of this.subscribers) listener(message);
  }

  post(message) {
    this.channel.postMessage({ channel: CHANNEL_NAME, from: this.tabId, ...message });
  }
}

function isMutatingRequest(operation, payload) {
  if (operation !== "gui") return false;
  return !["bootstrap", "market_state", "diagnostics"].includes(payload?.action);
}

function isMessage(value) {
  return value && typeof value === "object" && value.channel === CHANNEL_NAME;
}

function isEpoch(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isByteArray(value) {
  return (
    Array.isArray(value) &&
    value.length <= MAX_FORWARDED_CHUNK_BYTES &&
    value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  );
}

function normalizeSessionCredential(value) {
  if (
    value?.version === 1 &&
    value.provider === "openai" &&
    typeof value.apiKey === "string" &&
    value.apiKey.trim() &&
    value.storageMode === "session"
  ) {
    return {
      version: 2,
      credentials: { openai: { apiKey: value.apiKey.trim(), storageMode: "session" } },
    };
  }
  if (value?.version !== 2 || !value.credentials || typeof value.credentials !== "object") {
    return null;
  }
  const credentials = Object.fromEntries(
    Object.entries(value.credentials)
      .filter(
        ([provider, credential]) =>
          isFirstClassModelProvider(provider) &&
          typeof credential?.apiKey === "string" &&
          credential.apiKey.trim().length > 0 &&
          credential.storageMode === "session",
      )
      .map(([provider, credential]) => [
        provider,
        { apiKey: credential.apiKey.trim(), storageMode: "session" },
      ]),
  );
  return Object.keys(credentials).length > 0 ? { version: 2, credentials } : null;
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
import {
  isFirstClassModelProvider,
  modelSetupProviders,
} from "../../../../src/pi/model-provider-metadata.js";
