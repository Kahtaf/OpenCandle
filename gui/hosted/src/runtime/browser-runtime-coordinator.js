import { hostedGuiActionBlocksUpdate } from "../../../shared/hosted-gui-protocol.js";

const CHANNEL_NAME = "opencandle-hosted-coordination-v1";
const LOCK_NAME = "opencandle-hosted-writer-v1";
const EPOCH_KEY = "opencandle.hosted.runtime-epoch.v1";
const WRITER_HINT_KEY = "opencandle.hosted.runtime-writer.v1";
const CREDENTIAL_KEY = "opencandle.hosted.credentials.v1";
const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;
const FORWARDED_READ_RETRY_MS = 1_500;
const MAX_FORWARDED_READ_ATTEMPTS = 3;
const FORWARDED_SESSION_READ_TIMEOUT_MS = 15_000;
const MAX_FORWARDED_CHUNK_BYTES = 64 * 1024;
const WRITER_TAKEOVER_TIMEOUT_MS = 15_000;

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
    this.runtimeProgress = { phase: "booting", message: "Starting browser runtime…" };
    this.writerBootstrap = null;
    this.cachedModelSetup = null;
    this.sessionCredential = readSessionCredential(this.sessionStorage);
    this.pending = new Map();
    this.completed = new Map();
    this.activeForwardedStreams = new Map();
    this.subscribers = new Set();
    this.disposed = false;
    this.releaseWriter = null;
    this.writerReadyPromise = null;
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.channel.onmessage = (event) => this.handleMessage(event.data);
    this.handleNetworkChange = () =>
      this.notify({ type: "invalidate", reason: "network", epoch: this.epoch });
    this.eventTarget.addEventListener?.("online", this.handleNetworkChange);
    this.eventTarget.addEventListener?.("offline", this.handleNetworkChange);
    this.writerLockPromise = null;
    this.restoreWriterHint();
    this.queueWriterLock();
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

  getRuntimeProgress() {
    return this.runtimeProgress;
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
    try {
      return await this.requestFromCurrentWriter(operation, payload, options);
    } catch (error) {
      // GUI reads are idempotent from the caller's perspective. A writer
      // handoff can happen after the old writer receives the request but before
      // it responds; retry it once against the new owner instead of leaving a
      // route permanently in its loading state.
      if (!shouldRetryAfterWriterChange(error, operation, payload, options.signal, this.disposed)) {
        if (!shouldRecoverUnavailableGuiRead(error, operation, payload, options.signal, this.disposed)) {
          throw error;
        }
        // A visible tab must not remain dependent on a background tab that
        // holds the lock but is no longer servicing BroadcastChannel work.
        // Take over this session read so the local browser checkpoint remains
        // available without asking the user to close another tab first.
        await this.takeWriter();
        return this.requestFromCurrentWriter(operation, payload, options);
      }
      return this.requestFromCurrentWriter(operation, payload, options);
    }
  }

  async requestFromCurrentWriter(operation, payload, options) {
    // Session-changing UI actions must execute in the tab that initiated them.
    // A background writer can be throttled while a user is actively navigating
    // or saving in another tab, which otherwise surfaces as "did not respond".
    if (this.role !== "writer" && isMutatingRequest(operation, payload)) {
      await this.takeWriter();
    }
    if (this.role === "writer") {
      const host = await this.waitForWriterReady();
      const value = await host.request(
        operation,
        this.reconcileRestoredSessionTarget(operation, payload),
        options,
      );
      if (isMutatingRequest(operation, payload)) this.broadcastInvalidation();
      return this.decorate(value);
    }
    return this.forward({ kind: "request", operation, payload }, options.signal);
  }

  async handleCommand(command) {
    await this.ready();
    const purgesSecrets =
      command?.type === "hosted.data.clear_secrets" || command?.type === "hosted.data.clear_all";
    let value;
    if (this.role === "writer") {
      const host = await this.waitForWriterReady();
      value = await host.handleCommand(command);
      this.cachedModelSetup = host.getModelSetup?.() ?? this.cachedModelSetup;
      this.broadcastStatus();
      this.broadcastInvalidation();
    } else if (isInteractiveCommand(command)) {
      await this.takeWriter();
      const host = await this.waitForWriterReady();
      value = await host.handleCommand(command);
      this.cachedModelSetup = host.getModelSetup?.() ?? this.cachedModelSetup;
      this.broadcastStatus();
      this.broadcastInvalidation();
    } else {
      try {
        value = await this.forward({ kind: "command", command });
      } catch (error) {
        // A read-only command such as a setup refresh or local export should
        // not leave the foreground tab stuck behind an unresponsive writer.
        // These commands have no remote side effect, so rerun them locally
        // after ownership moves just as we do for idempotent GUI reads.
        if (!shouldRecoverUnavailableForwardedCommand(error, command, this.disposed)) throw error;
        await this.takeWriter();
        const host = await this.waitForWriterReady();
        value = await host.handleCommand(command);
        this.cachedModelSetup = host.getModelSetup?.() ?? this.cachedModelSetup;
        this.broadcastStatus();
      }
    }
    if (purgesSecrets) {
      this.clearSessionCredential();
      this.post({ type: "credentials-purged", epoch: this.epoch });
    }
    return value;
  }

  async streamRequest(operation, payload = {}, options = {}) {
    await this.ready();
    // A chat turn is stateful and long-lived. Forwarding its stream through a
    // background tab leaves the initiating tab dependent on a second event
    // loop, and can strand the visible turn when that writer is suspended.
    // Promote the tab where the user pressed Send instead. This keeps one
    // WebContainer at a time while making the active tab the owner of its
    // own model request, matching the local GUI's interaction model.
    if (this.role !== "writer") await this.takeWriter();
    if (this.role !== "writer") {
      throw new Error("The active hosted tab did not become the browser runtime writer");
    }
    const host = await this.waitForWriterReady();
    const response = await host.streamRequest(operation, payload, options);
    return this.wrapWriterStream(response);
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const active of this.activeForwardedStreams.values()) {
      active.controller.abort();
      void active.reader?.cancel("Hosted runtime coordinator closed");
    }
    this.activeForwardedStreams.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.clearRetry?.();
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
    const restoringExistingWriter = this.role === "follower";
    const previous = Number.parseInt(this.storage.getItem(EPOCH_KEY) ?? "0", 10);
    const nextEpoch = Number.isSafeInteger(previous) && previous >= 0 ? previous + 1 : 1;
    if (nextEpoch !== this.epoch) this.rejectPendingForWriterChange();
    this.epoch = nextEpoch;
    this.storage.setItem(EPOCH_KEY, String(this.epoch));
    this.writerId = this.tabId;
    this.storage.setItem(WRITER_HINT_KEY, JSON.stringify({ epoch: this.epoch, writerId: this.tabId }));
    this.role = "writer";
    const host = this.createHost({ sessionCredential: this.sessionCredential });
    this.host = host;
    // Overlap WebContainer startup with the UI's initial render while keeping
    // each writer's request surface behind one readiness barrier. A replacement
    // writer additionally restores its durable session before it accepts chat.
    this.runtimeProgress = {
      type: "runtime-progress",
      phase: "booting",
      message: "Preparing browser runtime…",
    };
    this.notify(this.runtimeProgress);
    this.writerBootstrap = null;
    this.writerReadyPromise = Promise.resolve(host.prewarm?.())
      .then(() => {
        if (this.host !== host || this.role !== "writer") return;
        if (restoringExistingWriter) {
          this.runtimeProgress = {
            type: "runtime-progress",
            phase: "restoring",
            message: "Restoring local OpenCandle session…",
          };
          this.notify(this.runtimeProgress);
          // A follower takes ownership only after the old WebContainer is
          // gone. Prime the replacement from the durable browser checkpoint
          // before allowing a new chat to write its first checkpoint; without
          // this barrier, a chat and bootstrap can race and strand the visible
          // run before its run.started event.
          return host.request("gui", { action: "bootstrap" });
        }
        return null;
      })
      .then((bootstrap) => {
        if (this.host !== host || this.role !== "writer") return;
        if (bootstrap?.sessionId) {
          this.writerBootstrap = bootstrap;
          this.notify({ type: "restored-bootstrap", bootstrap: this.decorate(bootstrap) });
        }
        this.runtimeProgress = {
          type: "runtime-progress",
          phase: "ready",
          message: "Running on this device",
        };
        this.notify(this.runtimeProgress);
      })
      .catch((error) => {
        if (this.host !== host || this.role !== "writer") return;
        this.runtimeProgress = {
          type: "runtime-progress",
          phase: "error",
          error: error instanceof Error ? error.message : String(error),
        };
        this.notify(this.runtimeProgress);
        throw error;
      });
    // The barrier is also awaited by every writer operation. Mark its rejected
    // branch handled now so a boot error is surfaced by the UI request instead
    // of becoming an unhandled background rejection.
    void this.writerReadyPromise.catch(() => {});
    this.cachedModelSetup = this.host.getModelSetup?.() ?? null;
    this.resolveReady();
    this.broadcastStatus();
    this.notify({ type: "coordination", role: this.role, epoch: this.epoch });
  }

  queueWriterLock() {
    const lockPromise = this.lockManager.request(LOCK_NAME, async () => {
      if (this.disposed) return;
      await this.becomeWriter();
      await new Promise((resolve) => {
        this.releaseWriter = resolve;
      });
      await this.stopWriter();
    });
    this.writerLockPromise = lockPromise;
    void lockPromise.then(
      () => {
        if (!this.disposed) this.queueWriterLock();
      },
      (error) => this.rejectReady(error),
    );
  }

  async takeWriter() {
    if (this.role === "writer") return;
    if (!this.writerId || !isEpoch(this.epoch)) {
      throw new Error("The active hosted tab is not available. Reload this tab and try again.");
    }
    this.runtimeProgress = {
      type: "runtime-progress",
      phase: "switching",
      message: "Switching browser runtime to this tab…",
    };
    this.notify(this.runtimeProgress);
    try {
      await new Promise((resolve, reject) => {
        let requestedWriterId = "";
        let unsubscribe = () => {};
        const timer = setTimeout(() => {
          unsubscribe();
          reject(new Error("The active hosted tab did not release the browser runtime"));
        }, Math.min(this.requestTimeoutMs, WRITER_TAKEOVER_TIMEOUT_MS));
        unsubscribe = this.subscribe((message) => {
          if (message?.type !== "coordination") return;
          if (this.role === "writer") {
            clearTimeout(timer);
            unsubscribe();
            resolve();
            return;
          }
          requestCurrentWriterToYield();
        });
        const requestCurrentWriterToYield = () => {
          if (!this.writerId || this.writerId === requestedWriterId || !isEpoch(this.epoch)) return;
          requestedWriterId = this.writerId;
          this.post({ type: "writer-yield-request", epoch: this.epoch, target: this.writerId });
        };
        requestCurrentWriterToYield();
      });
    } catch (error) {
      if (this.role !== "writer") {
        this.runtimeProgress = {
          type: "runtime-progress",
          phase: "error",
          error: error instanceof Error ? error.message : String(error),
        };
        this.notify(this.runtimeProgress);
      }
      throw error;
    }
  }

  async stopWriter() {
    // A yielded writer must not keep a forwarded run alive while the next
    // lock owner is starting. Abort both the runtime request and its reader:
    // cancellation can arrive before `streamRequest()` has returned.
    const activeStreams = [...this.activeForwardedStreams.values()];
    this.activeForwardedStreams.clear();
    for (const active of activeStreams) {
      active.controller.abort();
      void active.reader?.cancel("Hosted writer yielded the stream");
    }
    const host = this.host;
    this.host = null;
    this.writerBootstrap = null;
    this.writerReadyPromise = null;
    this.releaseWriter = null;
    this.clearWriterHintIfOwned();
    if (host) await host.dispose?.();
    if (!this.disposed) {
      this.role = "follower";
      this.writerId = "";
      this.notify({ type: "coordination", role: this.role, epoch: this.epoch });
    }
  }

  reconcileRestoredSessionTarget(operation, payload) {
    if (operation !== "gui" || payload?.action !== "tool_invoke") return payload;
    const requestedSessionId = String(payload.sessionId || "").trim();
    const restoredSessionId = String(this.writerBootstrap?.sessionId || "").trim();
    if (!requestedSessionId || !restoredSessionId || requestedSessionId === restoredSessionId) {
      return payload;
    }
    // Market-state changes are global and deliberately opt out of transcript
    // recording. During a writer handoff they can safely follow the canonical
    // restored session, even if the page still holds a route id from before
    // the old runtime yielded.
    if (payload.recordTranscript === false) {
      return { ...payload, sessionId: restoredSessionId };
    }
    const restoredSessionIds = new Set(
      (this.writerBootstrap?.checkpoint?.sessions || [])
        .map((session) => String(session?.sessionId || "").trim())
        .filter(Boolean),
    );
    if (restoredSessionIds.has(requestedSessionId)) return payload;
    // A handoff only mounts the durable checkpoint that its replacement writer
    // restored. Do not send a direct UI action to a stale route/session id
    // which the new runtime cannot resolve; attach it to the canonical restored
    // session and publish that snapshot to the visible tab.
    return { ...payload, sessionId: restoredSessionId };
  }

  forward(payload, signal) {
    const requestId = randomId();
    return new Promise((resolve, reject) => {
      let retryTimer = null;
      let attempts = 0;
      const clearRetry = () => {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
      };
      const abort = () => {
        clearTimeout(timer);
        clearRetry();
        this.pending.delete(requestId);
        reject(new DOMException("The operation was aborted", "AbortError"));
      };
      const timeoutMs = isRecoverableForwardedGuiRead(payload)
        ? Math.min(this.requestTimeoutMs, FORWARDED_SESSION_READ_TIMEOUT_MS)
        : this.requestTimeoutMs;
      const timer = setTimeout(() => {
        clearRetry();
        this.pending.delete(requestId);
        reject(new Error("The active hosted tab did not respond"));
      }, timeoutMs);
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      const post = () => {
        attempts += 1;
        this.post({
          type: "request",
          epoch: this.epoch,
          requestId,
          target: this.writerId,
          ...payload,
        });
        if (isRecoverableForwardedGuiRead(payload) && attempts < MAX_FORWARDED_READ_ATTEMPTS) {
          retryTimer = setTimeout(post, FORWARDED_READ_RETRY_MS);
        }
      };
      this.pending.set(requestId, { resolve, reject, timer, signal, abort, clearRetry });
      post();
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
    const onTimeout = () => {
      signal?.removeEventListener("abort", abort);
      this.pending.delete(requestId);
      this.post({ type: "cancel", epoch: this.epoch, requestId, target: this.writerId });
      streamController.error(new Error("The active hosted tab did not complete the stream"));
    };
    const timer = setTimeout(onTimeout, this.requestTimeoutMs);
    const abort = () => {
      clearTimeout(this.pending.get(requestId)?.timer ?? timer);
      this.pending.delete(requestId);
      this.post({ type: "cancel", epoch: this.epoch, requestId, target: this.writerId });
      streamController.error(new DOMException("The operation was aborted", "AbortError"));
    };
    if (signal?.aborted) abort();
    else {
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(requestId, {
        streamController,
        timer,
        timeoutMs: this.requestTimeoutMs,
        onTimeout,
        signal,
        abort,
      });
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
    if (message.type === "writer-yield-request") {
      if (this.role === "writer" && message.target === this.tabId) this.releaseWriter?.();
      return;
    }
    if (message.type === "credentials-purged") {
      this.clearSessionCredential();
      return;
    }
    if (message.type === "cancel") {
      if (this.role === "writer" && message.target === this.tabId) {
        const active = this.activeForwardedStreams.get(message.requestId);
        active?.controller.abort();
        void active?.reader?.cancel("Hosted follower cancelled the stream");
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
      pending.clearRetry?.();
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
          pending.streamController.enqueue(Uint8Array.from(message.value));
          refreshStreamInactivityTimer(pending);
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

  clearSessionCredential() {
    this.sessionStorage?.removeItem(CREDENTIAL_KEY);
    this.sessionCredential = null;
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
        const host = await this.waitForWriterReady();
        if (message.kind === "command") return host.handleCommand(message.command);
        if (message.kind === "request" && typeof message.operation === "string") {
          return host.request(message.operation, message.payload ?? {});
        }
        throw new Error("Hosted follower action is invalid");
      })();
      this.completed.set(message.requestId, operation);
      if (this.completed.size > 256) this.completed.delete(this.completed.keys().next().value);
    }
    try {
      const value = await operation;
      this.cachedModelSetup = this.host.getModelSetup?.() ?? this.cachedModelSetup;
      this.post({
        type: "response",
        epoch: this.epoch,
        requestId: message.requestId,
        target: message.from,
        ok: true,
        // Checkpoints can contain every session JSONL file and the SQLite
        // database. The writer has already persisted that archive in the
        // shared browser profile; a follower needs only the projected GUI
        // snapshot. Sending the archive through BroadcastChannel can exceed
        // its structured-clone budget and leave a route loading indefinitely.
        value: withoutDurableCheckpoint(value),
      });
      this.broadcastStatus();
      if (forwardedRequestMutates(message)) this.broadcastInvalidation();
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
    const active = { controller, reader: null };
    this.activeForwardedStreams.set(message.requestId, active);
    try {
      const host = await this.waitForWriterReady();
      const response = await host.streamRequest(
        message.operation,
        message.payload ?? {},
        { signal: controller.signal },
      );
      if (!response.ok || !response.body) throw new Error("Hosted writer could not start the stream");
      const reader = response.body.getReader();
      active.reader = reader;
      if (controller.signal.aborted) {
        await reader.cancel("Hosted follower cancelled before the stream started");
        return;
      }
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (controller.signal.aborted) {
          await reader.cancel("Hosted follower cancelled the stream");
          return;
        }
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

  async waitForWriterReady() {
    const host = this.host;
    if (this.role !== "writer" || !host) {
      throw new Error("The active hosted tab did not become the browser runtime writer");
    }
    await this.writerReadyPromise;
    if (this.role !== "writer" || this.host !== host) {
      throw writerChangedError();
    }
    return host;
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

  restoreWriterHint() {
    const hint = readWriterHint(this.storage);
    if (!hint) return;
    this.epoch = hint.epoch;
    this.writerId = hint.writerId;
    this.role = "follower";
    this.resolveReady();
    this.notify({ type: "coordination", role: this.role, epoch: this.epoch });
  }

  clearWriterHintIfOwned() {
    const hint = readWriterHint(this.storage);
    if (hint?.epoch === this.epoch && hint.writerId === this.tabId) {
      this.storage.removeItem(WRITER_HINT_KEY);
    }
  }

  rejectPendingForWriterChange() {
    const error = writerChangedError();
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.clearRetry?.();
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

function writerChangedError() {
  const error = new Error(
    "The hosted writer changed before the action completed. Check the current state, then retry.",
  );
  error.code = "HOSTED_WRITER_CHANGED";
  return error;
}

function shouldRetryAfterWriterChange(error, operation, payload, signal, disposed) {
  return (
    !disposed &&
    !signal?.aborted &&
    error?.code === "HOSTED_WRITER_CHANGED" &&
    operation === "gui" &&
    (payload?.action === "bootstrap" || payload?.action === "load_session")
  );
}

function shouldRecoverUnavailableGuiRead(error, operation, payload, signal, disposed) {
  return (
    !disposed &&
    !signal?.aborted &&
    error instanceof Error &&
    error.message === "The active hosted tab did not respond" &&
    isRecoverableGuiRead(operation, payload)
  );
}

function shouldRecoverUnavailableForwardedCommand(error, command, disposed) {
  return (
    !disposed &&
    error instanceof Error &&
    error.message === "The active hosted tab did not respond" &&
    !isInteractiveCommand(command)
  );
}

function refreshStreamInactivityTimer(pending) {
  if (
    !pending?.streamController ||
    typeof pending.timeoutMs !== "number" ||
    typeof pending.onTimeout !== "function"
  ) return;
  clearTimeout(pending.timer);
  pending.timer = setTimeout(pending.onTimeout, pending.timeoutMs);
}

function isInteractiveCommand(command) {
  return (
    typeof command?.type === "string" &&
    command.type !== "model.setup.refresh" &&
    command.type !== "hosted.data.export"
  );
}

function isMutatingRequest(operation, payload) {
  if (operation !== "gui") return false;
  return hostedGuiActionBlocksUpdate(payload?.action);
}

function forwardedRequestMutates(message) {
  if (message.kind === "command") return true;
  return message.kind === "request" && isMutatingRequest(message.operation, message.payload ?? {});
}

function isRecoverableForwardedGuiRead(payload) {
  return (
    payload?.kind === "request" &&
    isRecoverableGuiRead(payload.operation, payload.payload)
  );
}

function isRecoverableGuiRead(operation, payload) {
  // `load_session` changes the runtime's current manager, but remains safe to
  // retry after takeover because it has no external side effect. Every
  // protocol-declared GUI read is likewise idempotent; keeping them on the
  // short failover path prevents a visible diagnostics or market page from
  // waiting behind a background tab for the normal three-minute deadline.
  return (
    operation === "gui" &&
    (payload?.action === "load_session" || !hostedGuiActionBlocksUpdate(payload?.action))
  );
}

function withoutDurableCheckpoint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (!Object.prototype.hasOwnProperty.call(value, "checkpoint")) return value;
  const { checkpoint: _checkpoint, ...projected } = value;
  return projected;
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

function readSessionCredential(storage) {
  try {
    const serialized = storage?.getItem(CREDENTIAL_KEY);
    return serialized ? normalizeSessionCredential(JSON.parse(serialized)) : null;
  } catch {
    return null;
  }
}

function readWriterHint(storage) {
  try {
    const serialized = storage?.getItem(WRITER_HINT_KEY);
    if (!serialized) return null;
    const value = JSON.parse(serialized);
    const epoch = value?.epoch;
    const writerId = typeof value?.writerId === "string" ? value.writerId.trim() : "";
    return isEpoch(epoch) && writerId ? { epoch, writerId } : null;
  } catch {
    return null;
  }
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
import {
  isFirstClassModelProvider,
  modelSetupProviders,
} from "../../../../src/pi/model-provider-metadata.js";
