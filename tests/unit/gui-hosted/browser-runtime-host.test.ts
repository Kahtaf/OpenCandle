import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserRuntimeHost,
  createDurableSseGate,
} from "../../../gui/hosted/src/runtime/browser-runtime-host.js";

describe("browser runtime host", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits for a superseded WebContainer boot to tear down before disposal completes", async () => {
    let resolveBoot!: (container: { teardown: ReturnType<typeof vi.fn> }) => void;
    const teardown = vi.fn(async () => {});
    const host = createBrowserRuntimeHost({
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: {},
      webContainerApiKey: "",
      WebContainerImpl: {
        boot: vi.fn(
          () =>
            new Promise((resolve) => {
              resolveBoot = resolve;
            }),
        ),
      },
    });

    const prewarm = host.prewarm();
    await Promise.resolve();
    const disposal = host.dispose();
    resolveBoot({ teardown });

    await expect(prewarm).rejects.toThrow("superseded");
    await disposal;
    expect(teardown).toHaveBeenCalledOnce();
  });

  it("does not acknowledge a checkpoint after its request has timed out or changed runtime", async () => {
    let resolvePersist!: (value: boolean) => void;
    const write = vi.fn(async () => {});
    const host = createBrowserRuntimeHost({
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: {
        persistCheckpoint: vi.fn(
          () =>
            new Promise<boolean>((resolve) => {
              resolvePersist = resolve;
            }),
        ),
      },
    });
    host.runtimeEpoch = "0123456789abcdef0123456789abcdef";
    host.processWriter = { write };
    host.pendingRequests.set("request-1", {});

    const acknowledgement = host.acknowledgeRuntimeCheckpoint({
      requestId: "request-1",
      checkpointId: "checkpoint-1",
      value: {},
    });
    host.pendingRequests.delete("request-1");
    host.runtimeEpoch = "fedcba9876543210fedcba9876543210";
    resolvePersist(true);

    await acknowledgement;
    expect(write).not.toHaveBeenCalled();
  });

  it("validates an import before stopping the active runtime", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    const validateImport = vi.fn(() => {
      throw new Error("Unsupported hosted archive version");
    });
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: { validateImport },
    });
    host.stopRuntime = vi.fn();

    await expect(
      host.handleCommand({ type: "hosted.data.import", archive: '{"version":999}' }),
    ).rejects.toThrow("Unsupported hosted archive version");
    expect(validateImport).toHaveBeenCalledWith('{"version":999}');
    expect(host.stopRuntime).not.toHaveBeenCalled();
  });

  it("runs full SQLite import validation before stopping the active runtime", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    const validateImportForRestore = vi.fn(async () => {
      throw new Error("State snapshot failed SQLite integrity check");
    });
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: { validateImportForRestore },
    });
    host.stopRuntime = vi.fn();

    await expect(
      host.handleCommand({ type: "hosted.data.import", archive: "valid-looking" }),
    ).rejects.toThrow("integrity check");

    expect(validateImportForRestore).toHaveBeenCalledWith("valid-looking");
    expect(host.stopRuntime).not.toHaveBeenCalled();
  });

  it("does not overwrite the pre-import recovery backup when the imported runtime fails to boot", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("location", { origin: "https://web.opencandle.app" });
    vi.stubGlobal("__OPENCANDLE_RUNTIME_VERSION__", "test");
    const createBackup = vi.fn(async () => true);
    const restoreBackup = vi.fn(async () => true);
    const dataStore = {
      validateImportForRestore: vi.fn(async () => ({})),
      importAll: vi.fn(async () => ({ currentSessionId: "imported-session" })),
      readRuntimeSnapshot: vi.fn(async () => ({
        sessions: [],
        stateBytes: new Uint8Array([1]),
        currentSessionId: "imported-session",
      })),
      createBackup,
      restoreBackup,
    };
    const host = createBrowserRuntimeHost({
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore,
      WebContainerImpl: {
        boot: vi.fn(async () => ({ mount: vi.fn(async () => {}), teardown: vi.fn() })),
      },
    });
    host.fetchAssetText = vi.fn(async (path: string) =>
      path.includes("runtime-files.json")
        ? JSON.stringify({
            version: 1,
            entry: "runtime-bundle.mjs",
            files: ["runtime-bundle.mjs"],
          })
        : "runtime",
    );
    host.fetchAssetBytes = vi.fn(async () => new Uint8Array());
    host.startProcess = vi.fn(async () => {
      throw new Error("imported runtime failed");
    });

    await expect(
      host.handleCommand({ type: "hosted.data.import", archive: "validated archive" }),
    ).rejects.toThrow("imported runtime failed");

    expect(createBackup).not.toHaveBeenCalled();
    expect(restoreBackup).toHaveBeenCalledOnce();
  });

  it("serves persisted market state while offline", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("navigator", { onLine: false });
    const marketState = {
      watchlists: [{ id: 1, name: "Watchlist" }],
      watchlist: [{ id: 2, symbol: "AAPL" }],
      portfolios: [],
      portfolio: [],
    };
    const readOfflineBootstrap = vi.fn(async () => ({
      role: "writer",
      sessionId: "session-1",
      sessions: [],
      snapshot: { entries: [], events: [], state: {} },
      marketState,
    }));
    const host = createBrowserRuntimeHost({
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: { readOfflineBootstrap },
    });

    await expect(host.request("gui", { action: "market_state" })).resolves.toEqual(marketState);
    expect(readOfflineBootstrap).toHaveBeenCalledOnce();
  });

  it("advances the recovery backup only after the imported runtime boots successfully", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("navigator", { onLine: true });
    const events: string[] = [];
    const dataStore = {
      validateImportForRestore: vi.fn(async () => ({})),
      importAll: vi.fn(async () => ({ currentSessionId: "imported-session" })),
      createBackup: vi.fn(async () => {
        events.push("backup");
        return true;
      }),
      persistCheckpoint: vi.fn(async () => {
        events.push("persisted");
      }),
    };
    const host = createBrowserRuntimeHost({
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore,
    });
    host.stopRuntime = vi.fn(async () => {});
    host.boot = vi.fn(async () => {
      events.push("booted");
    });
    host.request = vi.fn(async () => {
      await host.persistCheckpoint({ sessionId: "imported-session" });
      return { sessionId: "imported-session" };
    });

    await host.handleCommand({ type: "hosted.data.import", archive: "validated archive" });

    expect(events).toEqual(["booted", "persisted", "backup"]);
  });

  it("restores the original archive when an imported same-version database fails bootstrap", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("navigator", { onLine: true });
    const restoreBackup = vi.fn(async () => true);
    const dataStore = {
      validateImportForRestore: vi.fn(async () => ({})),
      importAll: vi.fn(async () => ({ currentSessionId: "imported-session" })),
      restoreBackup,
      readRuntimeSnapshot: vi.fn(async () => ({ currentSessionId: "original-session" })),
      createBackup: vi.fn(async () => true),
    };
    const storage = memoryStorage();
    const host = createBrowserRuntimeHost({
      storage,
      sessionStorage: memoryStorage(),
      dataStore,
    });
    host.stopRuntime = vi.fn(async () => {});
    host.ensureBooted = vi.fn(async () => {});
    host.request = vi.fn(async () => {
      throw new Error("Imported state schema is incompatible");
    });

    await expect(
      host.handleCommand({ type: "hosted.data.import", archive: "validated archive" }),
    ).rejects.toThrow("schema is incompatible");

    expect(restoreBackup).toHaveBeenCalledOnce();
    expect(host.stopRuntime).toHaveBeenCalledTimes(2);
    expect(storage.getItem("opencandle.hosted.current-session.v1")).toBe("original-session");
  });

  it("waits for non-stream mutations before preparing an update", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("navigator", { onLine: false });
    const createBackup = vi.fn(async () => true);
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: { createBackup },
    });
    host.pendingRequests.set("mutation", { streamController: null, blocksUpdate: true });

    const prepared = host.handleCommand({ type: "hosted.runtime.prepare_update" });
    await vi.advanceTimersByTimeAsync(50);
    expect(createBackup).not.toHaveBeenCalled();

    host.pendingRequests.delete("mutation");
    await vi.advanceTimersByTimeAsync(50);

    await expect(prepared).resolves.toEqual({ ready: true });
    expect(createBackup).toHaveBeenCalledOnce();
  });

  it("does not let background read polling starve an update", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("navigator", { onLine: false });
    const createBackup = vi.fn(async () => true);
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: { createBackup },
    });
    host.pendingRequests.set("quote", { streamController: null, blocksUpdate: false });

    await expect(host.handleCommand({ type: "hosted.runtime.prepare_update" })).resolves.toEqual({
      ready: true,
    });
    expect(createBackup).toHaveBeenCalledOnce();
  });

  it("preserves the overall stream deadline after the first valid stream message", () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    const clearTimeout = vi.spyOn(globalThis, "clearTimeout");
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: {},
    });
    host.runtimeEpoch = "runtime-epoch";
    const push = vi.fn();
    host.pendingRequests.set("stream-1", {
      runtimeEpoch: "runtime-epoch",
      timer: 42,
      streamController: {},
      sseGate: { push },
    });

    host.handleRuntimeMessage({
      type: "stream-event",
      requestId: "stream-1",
      runtimeEpoch: "runtime-epoch",
      event: { type: "run.started" },
    });
    host.handleRuntimeMessage({
      type: "stream-event",
      requestId: "stream-1",
      runtimeEpoch: "runtime-epoch",
      event: { type: "tool.started" },
    });

    expect(clearTimeout).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("persists runtime checkpoints before acknowledging streamed work", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    const persistCheckpoint = vi.fn(async () => true);
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: { persistCheckpoint },
    });
    host.runtimeEpoch = "runtime-epoch";
    host.pendingRequests.set("stream-1", {
      runtimeEpoch: "runtime-epoch",
      streamController: {},
      sseGate: { push: vi.fn() },
    });
    host.writeProcessMessage = vi.fn(async () => {});

    host.handleRuntimeMessage({
      type: "checkpoint",
      requestId: "stream-1",
      checkpointId: "checkpoint-1",
      runtimeEpoch: "runtime-epoch",
      value: { sessionId: "session-1", checkpoint: { sessions: [], state: {} } },
    });

    await vi.waitFor(() =>
      expect(host.writeProcessMessage).toHaveBeenCalledWith({
        type: "checkpoint-ack",
        runtimeEpoch: "runtime-epoch",
        requestId: "stream-1",
        checkpointId: "checkpoint-1",
        ok: true,
      }),
    );
    expect(persistCheckpoint).toHaveBeenCalledOnce();
  });

  it("refreshes the inactivity timeout when a stream makes progress", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("navigator", { onLine: true });
    const write = vi.fn(async () => {});
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: {},
    });
    host.processWriter = { write };
    host.runtimeEpoch = "0123456789abcdef0123456789abcdef";
    host.bootPromise = Promise.resolve();

    const response = await host.streamRequest("chat", {}, { timeoutMs: 20 });
    const reader = response.body.getReader();
    const requestId = [...host.pendingRequests.keys()][0];
    host.handleRuntimeMessage({
      type: "stream-event",
      requestId,
      runtimeEpoch: host.runtimeEpoch,
      event: { type: "run.started" },
    });
    await expect(reader.read()).resolves.toMatchObject({ done: false });

    await vi.advanceTimersByTimeAsync(15);
    host.handleRuntimeMessage({
      type: "stream-event",
      requestId,
      runtimeEpoch: host.runtimeEpoch,
      event: { type: "tool.started" },
    });
    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await vi.advanceTimersByTimeAsync(15);
    expect(host.pendingRequests.has(requestId)).toBe(true);
    await vi.advanceTimersByTimeAsync(6);
    await expect(reader.read()).rejects.toThrow("timed out");
    expect(write).toHaveBeenLastCalledWith(expect.stringContaining('"type":"cancel"'));
  });

  it("cancels and unregisters a Pi stream when its browser consumer closes", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("navigator", { onLine: true });
    const write = vi.fn(async () => {});
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: {},
    });
    host.processWriter = { write };
    host.runtimeEpoch = "0123456789abcdef0123456789abcdef";
    host.bootPromise = Promise.resolve();

    const response = await host.streamRequest("chat", { message: "hello" });
    expect(host.pendingRequests.size).toBe(1);

    await response.body.cancel();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));

    expect(host.pendingRequests.size).toBe(0);
    expect(JSON.parse(write.mock.calls[1][0])).toMatchObject({
      type: "cancel",
    });
  });

  it("cleans up stream state when writing the request frame fails", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("navigator", { onLine: true });
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: {},
    });
    host.processWriter = {
      write: vi.fn(async () => {
        throw new Error("stdin closed");
      }),
    };
    host.runtimeEpoch = "0123456789abcdef0123456789abcdef";
    host.bootPromise = Promise.resolve();

    await expect(host.streamRequest("chat", {})).rejects.toThrow("stdin closed");
    expect(host.pendingRequests.size).toBe(0);
  });

  it("tears down and reboots the runtime after clearing all browser secrets", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("navigator", { onLine: true });
    const storage = memoryStorage();
    const sessionStorage = memoryStorage();
    storage.setItem(
      "opencandle.hosted.provider-credentials.v1",
      JSON.stringify({ version: 1, credentials: { fred: "fred-provider-key" } }),
    );
    storage.setItem(
      "opencandle.hosted.model-selection.v1",
      JSON.stringify({ version: 1, provider: "openai", modelId: "gpt-4.1-mini" }),
    );
    storage.setItem(
      "opencandle.hosted.credentials.v1",
      JSON.stringify({
        version: 1,
        provider: "openai",
        modelId: "gpt-4.1-mini",
        apiKey: "sk-live-secret",
        storageMode: "persistent",
      }),
    );
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage,
      sessionStorage,
      dataStore: {},
    });
    host.container = { teardown: vi.fn() };
    host.stopRuntime = vi.fn(async () => {
      host.container = null;
    });
    host.ensureBooted = vi.fn(async () => {});
    host.request = vi.fn();
    host.runtimeThinking = { current: "high", available: ["off", "high"] };

    await expect(host.handleCommand({ type: "hosted.data.clear_secrets" })).resolves.toMatchObject({
      modelSetup: { requirement: "api_key" },
    });

    expect(storage.getItem("opencandle.hosted.credentials.v1")).toBeNull();
    expect(sessionStorage.getItem("opencandle.hosted.credentials.v1")).toBeNull();
    expect(storage.getItem("opencandle.hosted.model-selection.v1")).toBeNull();
    expect(storage.getItem("opencandle.hosted.provider-credentials.v1")).toBeNull();
    expect(host.stopRuntime).toHaveBeenCalledTimes(1);
    expect(host.ensureBooted).toHaveBeenCalledTimes(1);
    expect(host.request).not.toHaveBeenCalledWith(
      "gui",
      expect.objectContaining({ action: "configure_model" }),
    );
    expect(host.getModelSetup()).not.toHaveProperty("currentThinkingLevel");
  });

  it("repopulates the active service worker shell after clearing browser caches", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    const worker = {
      postMessage: vi.fn((_message, ports: Array<{ postMessage: (value: unknown) => void }>) => {
        ports[0]?.postMessage({ ok: true });
      }),
    };
    vi.stubGlobal("navigator", {
      onLine: false,
      serviceWorker: {
        getRegistration: vi.fn(async () => ({ active: worker })),
      },
    });
    vi.stubGlobal("caches", {
      keys: vi.fn(async () => ["opencandle-hosted-shell-old"]),
      delete: vi.fn(async () => true),
    });
    vi.stubGlobal(
      "MessageChannel",
      class {
        port1 = { onmessage: null as null | ((event: { data: unknown }) => void), close: vi.fn() };
        port2 = {
          postMessage: (value: unknown) => {
            queueMicrotask(() => this.port1.onmessage?.({ data: value }));
          },
        };
      },
    );
    const storage = memoryStorage();
    const appKeys = [
      "opencandle.hosted.credentials.v1",
      "opencandle.hosted.model-selection.v1",
      "opencandle.hosted.provider-credentials.v1",
      "opencandle.hosted.current-session.v1",
      "opencandle.hosted.relay-client.v1",
      // Clearing everything leaves a first-time browser profile behind, so the
      // first-run onboarding dialog is owed its one automatic opening again.
      // The legacy dismissal goes too, or migration would resurrect the seen
      // state on the next read.
      "opencandle.onboarding.first-run-seen.v1",
      "opencandle.onboarding.first-run-dismissed.v1",
    ];
    for (const key of appKeys) storage.setItem(key, "retained-device-data");
    const host = createBrowserRuntimeHost({
      storage,
      sessionStorage: memoryStorage(),
      dataStore: { clearAll: vi.fn(async () => {}) },
    });

    await host.handleCommand({ type: "hosted.data.clear_all" });

    expect(worker.postMessage).toHaveBeenCalledWith(
      { type: "REPOPULATE_SHELL" },
      expect.any(Array),
    );
    expect(appKeys.map((key) => storage.getItem(key))).toEqual(appKeys.map(() => null));
  });

  it("keeps an inherited session credential through a reload of the promoted tab", () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    const storage = memoryStorage();
    const sessionStorage = memoryStorage();
    const credential = {
      version: 2,
      credentials: {
        anthropic: { apiKey: "session-only-key", storageMode: "session" },
      },
    };
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage,
      sessionStorage,
      sessionCredential: credential,
      dataStore: {},
    });

    expect(host.getSessionCredential()).toEqual(credential);
    expect(host.getModelSetup()).toMatchObject({
      requirement: "ready",
      supportsAttachments: true,
      currentModel: "anthropic/claude-haiku-4-5",
    });
    expect(storage.getItem("opencandle.hosted.credentials.v1")).toBeNull();
    expect(
      JSON.parse(sessionStorage.getItem("opencandle.hosted.credentials.v1") ?? "null"),
    ).toEqual(credential);

    const reloaded = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage,
      sessionStorage,
      dataStore: {},
    });
    expect(reloaded.getSessionCredential()).toEqual(credential);
    expect(reloaded.getModelSetup()).toMatchObject({
      requirement: "ready",
      currentModel: "anthropic/claude-haiku-4-5",
    });
  });

  it("reflects Pi thinking state without storing a second preference", () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    const storage = memoryStorage();
    storage.setItem(
      "opencandle.hosted.credentials.v1",
      JSON.stringify({
        version: 2,
        credentials: { openai: { apiKey: "openai-key", storageMode: "persistent" } },
      }),
    );
    storage.setItem(
      "opencandle.hosted.model-selection.v1",
      JSON.stringify({ version: 1, provider: "openai", modelId: "gpt-5-mini" }),
    );
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage,
      sessionStorage: memoryStorage(),
      dataStore: {},
    });

    host.captureRuntimeState({ thinking: { current: "medium", available: ["off", "medium"] } });

    expect(host.getModelSetup()).toMatchObject({
      currentThinkingLevel: "medium",
      availableThinkingLevels: ["off", "medium"],
    });

    host.captureRuntimeState({ sessionId: "session-1" });
    expect(host.getModelSetup()).toMatchObject({
      currentThinkingLevel: "medium",
      availableThinkingLevels: ["off", "medium"],
    });

    host.captureRuntimeState({ thinking: null });
    expect(host.getModelSetup()).not.toHaveProperty("currentThinkingLevel");
  });

  it("preserves provider credentials independently while switching Pi models", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    const storage = memoryStorage();
    const sessionStorage = memoryStorage();
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage,
      sessionStorage,
      dataStore: {},
    });
    host.request = vi.fn(async (_operation, body) =>
      body.action.startsWith("validate_") ? { status: "valid" } : {},
    );

    await host.handleCommand({
      type: "model.setup.save_api_key",
      provider: "openai",
      modelId: "gpt-5-mini",
      apiKey: "openai-key",
      storageMode: "persistent",
    });
    await host.handleCommand({
      type: "model.setup.save_api_key",
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
      apiKey: "anthropic-key",
      storageMode: "persistent",
    });
    await host.handleCommand({
      type: "model.setup.select_model",
      provider: "openai",
      modelId: "gpt-5-mini",
    });

    const stored = JSON.parse(storage.getItem("opencandle.hosted.credentials.v1"));
    expect(stored).toMatchObject({
      version: 2,
      credentials: {
        openai: { apiKey: "openai-key" },
        anthropic: { apiKey: "anthropic-key" },
      },
    });
    expect(host.getModelSetup()).toMatchObject({ currentModel: "openai/gpt-5-mini" });
    expect(host.request).toHaveBeenLastCalledWith("gui", {
      action: "configure_model",
      provider: "openai",
      modelId: "gpt-5-mini",
      apiKey: "openai-key",
    });
  });

  it("restarts a runtime that booted before relay authorization before probing a model key", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    const host = createBrowserRuntimeHost({
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: {},
    });
    host.process = {};
    host.processHasRelayConfiguration = false;
    host.ensureRelayAuthorization = vi.fn(async () => ({
      token: "runtime.signature",
      expiresAt: Date.now() + 60_000,
    }));
    host.stopRuntime = vi.fn(async () => {
      host.process = null;
    });
    host.request = vi.fn(async (_operation, body) =>
      body.action === "validate_model_key" ? { status: "valid" } : {},
    );

    await host.handleCommand({
      type: "model.setup.save_api_key",
      provider: "openai",
      modelId: "gpt-5-mini",
      apiKey: "openai-key",
      storageMode: "session",
    });

    expect(host.stopRuntime).toHaveBeenCalledOnce();
    expect(host.request).toHaveBeenNthCalledWith(1, "gui", {
      action: "validate_model_key",
      provider: "openai",
      apiKey: "openai-key",
    });
  });

  it("does not persist a model selection that the active runtime rejects", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    const storage = memoryStorage();
    storage.setItem(
      "opencandle.hosted.credentials.v1",
      JSON.stringify({
        version: 2,
        credentials: { openai: { apiKey: "openai-key", storageMode: "persistent" } },
      }),
    );
    storage.setItem(
      "opencandle.hosted.model-selection.v1",
      JSON.stringify({ version: 1, provider: "openai", modelId: "gpt-5-mini" }),
    );
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage,
      sessionStorage: memoryStorage(),
      dataStore: {},
    });
    host.request = vi.fn(async (_operation, body) => {
      if (body.action === "configure_model") throw new Error("research run is active");
      return {};
    });

    await expect(
      host.handleCommand({
        type: "model.setup.select_model",
        provider: "openai",
        modelId: "gpt-5.4",
      }),
    ).rejects.toThrow("active");

    expect(host.getModelSetup()).toMatchObject({ currentModel: "openai/gpt-5-mini" });
    expect(JSON.parse(storage.getItem("opencandle.hosted.model-selection.v1"))).toMatchObject({
      provider: "openai",
      modelId: "gpt-5-mini",
    });
  });

  it("stores provider keys only in browser storage and restarts the hosted process", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("navigator", { onLine: true });
    const storage = memoryStorage();
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage,
      sessionStorage: memoryStorage(),
      dataStore: {},
    });
    host.stopRuntime = vi.fn(async () => {});
    host.ensureBooted = vi.fn(async () => {});
    host.request = vi.fn(async () => ({ status: "valid" }));

    await host.handleCommand({
      type: "provider.save_api_key",
      providerId: "fred",
      apiKey: "fred-live-key",
    });

    expect(JSON.parse(storage.getItem("opencandle.hosted.provider-credentials.v1"))).toEqual({
      version: 1,
      credentials: { fred: "fred-live-key" },
    });
    expect(host.stopRuntime).toHaveBeenCalledOnce();
    expect(host.ensureBooted).toHaveBeenCalledOnce();
  });

  it("preserves an existing provider key when validation rejects its replacement", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    const storage = memoryStorage();
    storage.setItem(
      "opencandle.hosted.provider-credentials.v1",
      JSON.stringify({ version: 1, credentials: { fred: "existing-valid-key" } }),
    );
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage,
      sessionStorage: memoryStorage(),
      dataStore: {},
    });
    host.request = vi.fn(async () => ({ status: "invalid", httpStatus: 403 }));
    host.stopRuntime = vi.fn(async () => {});

    await expect(
      host.handleCommand({
        type: "provider.save_api_key",
        providerId: "fred",
        apiKey: "replacement-bad-key",
      }),
    ).rejects.toThrow("rejected");

    expect(JSON.parse(storage.getItem("opencandle.hosted.provider-credentials.v1"))).toEqual({
      version: 1,
      credentials: { fred: "existing-valid-key" },
    });
    expect(host.stopRuntime).not.toHaveBeenCalled();
  });

  it("preserves existing hosted credentials when validation cannot complete", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    const storage = memoryStorage();
    storage.setItem(
      "opencandle.hosted.credentials.v1",
      JSON.stringify({
        version: 2,
        credentials: { openai: { apiKey: "existing-model-key", storageMode: "persistent" } },
      }),
    );
    storage.setItem(
      "opencandle.hosted.provider-credentials.v1",
      JSON.stringify({ version: 1, credentials: { fred: "existing-provider-key" } }),
    );
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage,
      sessionStorage: memoryStorage(),
      dataStore: {},
    });
    host.request = vi.fn(async () => ({ status: "transient", reason: "relay unavailable" }));

    await expect(
      host.handleCommand({
        type: "model.setup.save_api_key",
        provider: "openai",
        modelId: "gpt-5-mini",
        apiKey: "unverified-model-key",
      }),
    ).rejects.toThrow("could not be verified");
    await expect(
      host.handleCommand({
        type: "provider.save_api_key",
        providerId: "fred",
        apiKey: "unverified-provider-key",
      }),
    ).rejects.toThrow("could not be verified");

    expect(host.readModelCredentials().openai.apiKey).toBe("existing-model-key");
    expect(host.readProviderCredentials().fred).toBe("existing-provider-key");
  });

  it("withholds run.completed until the durable checkpoint succeeds", async () => {
    const chunks: string[] = [];
    const gate = createDurableSseGate({
      enqueue: (value: Uint8Array) => chunks.push(new TextDecoder().decode(value)),
    });

    gate.push(
      new TextEncoder().encode(
        'data: {"type":"run.started"}\n\ndata: {"type":"run.completed"}\n\n',
      ),
    );

    expect(chunks.join("")).toContain("run.started");
    expect(chunks.join("")).not.toContain("run.completed");
    gate.releaseCompletion();
    expect(chunks.join("")).toContain("run.completed");
  });

  it("does not release run.completed when checkpoint persistence fails", async () => {
    const chunks: string[] = [];
    const gate = createDurableSseGate({
      enqueue: (value: Uint8Array) => chunks.push(new TextDecoder().decode(value)),
    });
    gate.push(new TextEncoder().encode('data: {"type":"run.completed"}\n\n'));
    gate.discardCompletion();

    expect(chunks.join("")).not.toContain("run.completed");
  });

  it("calls the in-browser Pi process over WebContainer stdio", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("navigator", { onLine: true });
    const write = vi.fn(async () => {});
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: { persistCheckpoint: vi.fn(async () => {}) },
    });
    host.processWriter = { write };
    host.runtimeEpoch = "0123456789abcdef0123456789abcdef";
    host.bootPromise = Promise.resolve();

    const response = host.request("gui", { action: "bootstrap" });
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    const request = JSON.parse(write.mock.calls[0][0]);
    host.handleRuntimeMessage({
      type: "response",
      runtimeEpoch: host.runtimeEpoch,
      requestId: request.requestId,
      ok: true,
      result: { runtimeState: "ready" },
    });
    await expect(response).resolves.toEqual({
      runtimeState: "ready",
    });
    expect(request).toMatchObject({
      type: "request",
      operation: "gui",
      payload: { action: "bootstrap" },
    });
  });

  it("does not let a delayed bootstrap checkpoint erase a newer session mutation", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("navigator", { onLine: true });
    const write = vi.fn(async () => {});
    const persistCheckpoint = vi.fn(async () => true);
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: { persistCheckpoint },
    });
    host.processWriter = { write };
    host.runtimeEpoch = "0123456789abcdef0123456789abcdef";
    host.bootPromise = Promise.resolve();

    const staleBootstrap = host.request("gui", { action: "bootstrap" });
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const bootstrapRequest = JSON.parse(write.mock.calls[0][0]);

    const newSession = host.request("gui", { action: "new_session" });
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    const mutationRequest = JSON.parse(write.mock.calls[1][0]);
    host.handleRuntimeMessage({
      type: "response",
      runtimeEpoch: host.runtimeEpoch,
      requestId: mutationRequest.requestId,
      ok: true,
      result: { sessionId: "fresh-session", checkpoint: { sessions: [] } },
    });
    await expect(newSession).resolves.toMatchObject({ sessionId: "fresh-session" });

    host.handleRuntimeMessage({
      type: "response",
      runtimeEpoch: host.runtimeEpoch,
      requestId: bootstrapRequest.requestId,
      ok: true,
      result: { sessionId: "stale-session", checkpoint: { sessions: [] } },
    });
    await expect(staleBootstrap).resolves.toMatchObject({ sessionId: "stale-session" });

    expect(persistCheckpoint).toHaveBeenCalledTimes(1);
    expect(persistCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "fresh-session" }),
    );
  });

  it("rejects an acknowledged GUI mutation when its durable checkpoint is missing", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("navigator", { onLine: true });
    const write = vi.fn(async () => {});
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: { persistCheckpoint: vi.fn(async () => false) },
    });
    host.processWriter = { write };
    host.runtimeEpoch = "0123456789abcdef0123456789abcdef";
    host.bootPromise = Promise.resolve();

    const response = host.request("gui", {
      action: "tool_invoke",
      sessionId: "session-1",
      actionId: "action-1",
      toolName: "manage_watchlist",
      args: { action: "add", symbol: "AAPL" },
    });
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    const request = JSON.parse(write.mock.calls[0][0]);
    host.handleRuntimeMessage({
      type: "response",
      runtimeEpoch: host.runtimeEpoch,
      requestId: request.requestId,
      ok: true,
      result: { result: { saved: true } },
    });

    await expect(response).rejects.toThrow("durable checkpoint");
  });

  it("allows credential validation responses without a state checkpoint", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("navigator", { onLine: true });
    const write = vi.fn(async () => {});
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: { persistCheckpoint: vi.fn(async () => false) },
    });
    host.processWriter = { write };
    host.runtimeEpoch = "0123456789abcdef0123456789abcdef";
    host.bootPromise = Promise.resolve();

    const response = host.request("gui", {
      action: "validate_model_key",
      provider: "openai",
      apiKey: "test-key",
    });
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    const request = JSON.parse(write.mock.calls[0][0]);
    host.handleRuntimeMessage({
      type: "response",
      runtimeEpoch: host.runtimeEpoch,
      requestId: request.requestId,
      ok: true,
      result: { status: "valid" },
    });

    await expect(response).resolves.toEqual({ status: "valid" });
  });

  it("configures the WebContainer client before the first boot only", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("__OPENCANDLE_RUNTIME_VERSION__", "test");
    const calls: string[] = [];
    const container = {
      mount: vi.fn(async () => {}),
    };
    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: {
        readRuntimeSnapshot: vi.fn(async () => ({
          sessions: [],
          stateBytes: null,
          currentSessionId: "",
        })),
      },
      webContainerApiKey: "wc_public_client_id",
      configureWebContainerApiKey: vi.fn(() => calls.push("configure")),
      WebContainerImpl: {
        boot: vi.fn(async () => {
          calls.push("boot");
          return container;
        }),
      },
    });
    host.fetchAssetText = vi.fn(async (path: string) =>
      path.includes("runtime-files.json")
        ? JSON.stringify({
            version: 1,
            entry: "runtime-bundle.mjs",
            files: ["runtime-bundle.mjs"],
          })
        : "runtime",
    );
    host.fetchAssetBytes = vi.fn(async () => new Uint8Array());
    host.startProcess = vi.fn(async () => {});

    await host.boot();
    await host.boot();

    expect(calls).toEqual(["configure", "boot", "boot"]);
  });

  it("mounts canonical action markers beside restored Pi sessions", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("__OPENCANDLE_RUNTIME_VERSION__", "test");
    const mount = vi.fn(async () => {});
    const actionStore = JSON.stringify({
      acceptedActionIds: ["run-1"],
      pendingActionIds: [],
      actionFingerprints: { "run-1": "fingerprint" },
    });
    const host = createBrowserRuntimeHost({
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: {
        readRuntimeSnapshot: vi.fn(async () => ({
          sessions: [
            {
              filename: "session.jsonl",
              content: '{"type":"session","version":3,"id":"session-1"}\n',
              actionStore,
            },
          ],
          stateBytes: null,
          currentSessionId: "session-1",
        })),
      },
      WebContainerImpl: { boot: vi.fn(async () => ({ mount })) },
    });
    host.fetchAssetText = vi.fn(async (path: string) =>
      path.includes("runtime-files.json")
        ? JSON.stringify({
            version: 1,
            entry: "runtime-bundle.mjs",
            files: ["runtime-bundle.mjs"],
          })
        : "runtime",
    );
    host.fetchAssetBytes = vi.fn(async () => new Uint8Array());
    host.startProcess = vi.fn(async () => {});

    await host.boot();

    expect(mount).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: {
          directory: expect.objectContaining({
            "session.jsonl.accepted-actions.json": { file: { contents: actionStore } },
          }),
        },
      }),
    );
  });

  it("passes only ephemeral signed relay authorization to the hosted process", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("location", { origin: "https://web.opencandle.app" });
    const storage = memoryStorage();
    const environments: Array<Record<string, string>> = [];
    const fetchRuntimeAuthorization = vi
      .fn()
      .mockResolvedValueOnce({ token: "runtime-one.signature", expiresAt: 2_000_000 })
      .mockResolvedValueOnce({ token: "runtime-two.signature", expiresAt: 3_000_000 });
    const run = async () => {
      const container = {
        spawn: vi.fn(async (_command, _args, options) => {
          environments.push(options.env);
          return {
            input: new WritableStream(),
            output: new ReadableStream({
              start(controller) {
                controller.enqueue(
                  `@@OPENCANDLE@@${JSON.stringify({
                    type: "ready",
                    runtimeEpoch: options.env.OPENCANDLE_RUNTIME_EPOCH,
                  })}\n`,
                );
              },
            }),
            exit: new Promise(() => {}),
            kill: vi.fn(),
          };
        }),
      };
      const host = createBrowserRuntimeHost({
        bridgeFrame: {},
        storage,
        sessionStorage: memoryStorage(),
        dataStore: {},
        relayUrl: "https://web.opencandle.app/v1/provider-fetch",
        fetchRuntimeAuthorization,
      });
      await host.startProcess(container);
    };

    await run();
    await run();

    const first = environments[0];
    const second = environments[1];
    expect(first.OPENCANDLE_PROVIDER_RELAY_URL).toBe(
      "https://web.opencandle.app/v1/provider-fetch",
    );
    expect(first.OPENCANDLE_PROVIDER_RELAY_CLIENT_ID).toMatch(/^[a-f0-9]{32}$/);
    expect(first.OPENCANDLE_PROVIDER_RELAY_ATTESTATION_TOKEN).toBeUndefined();
    expect(first.OPENCANDLE_PROVIDER_RELAY_TOKEN).toBe("runtime-one.signature");
    expect(first.OPENCANDLE_PROVIDER_RELAY_TOKEN_EXPIRES_AT).toBe("2000000");
    expect(second.OPENCANDLE_PROVIDER_RELAY_TOKEN).toBe("runtime-two.signature");
    expect(second.OPENCANDLE_PROVIDER_RELAY_TOKEN_EXPIRES_AT).toBe("3000000");
    expect(second.OPENCANDLE_PROVIDER_RELAY_CLIENT_ID).toBe(
      first.OPENCANDLE_PROVIDER_RELAY_CLIENT_ID,
    );
    expect(storage.getItem("opencandle.hosted.relay-client.v1")).toBe(
      first.OPENCANDLE_PROVIDER_RELAY_CLIENT_ID,
    );
    expect(storage.getItem("opencandle.hosted.runtime-token")).toBeNull();
    expect(fetchRuntimeAuthorization).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        relayUrl: "https://web.opencandle.app/v1/provider-fetch",
        clientId: first.OPENCANDLE_PROVIDER_RELAY_CLIENT_ID,
      }),
    );
  });

  it("boots in degraded mode when runtime authorization is unavailable", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("location", { origin: "https://web.opencandle.app" });
    let environment: Record<string, string> = {};
    const container = {
      spawn: vi.fn(async (_command, _args, options) => {
        environment = options.env;
        return {
          input: new WritableStream(),
          output: new ReadableStream({
            start(controller) {
              controller.enqueue(
                `@@OPENCANDLE@@${JSON.stringify({
                  type: "ready",
                  runtimeEpoch: options.env.OPENCANDLE_RUNTIME_EPOCH,
                })}\n`,
              );
            },
          }),
          exit: new Promise(() => {}),
          kill: vi.fn(),
        };
      }),
    };
    const host = createBrowserRuntimeHost({
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: {},
      relayUrl: "https://web.opencandle.app/v1/provider-fetch",
      fetchRuntimeAuthorization: vi.fn(async () => {
        throw new Error("unavailable");
      }),
    });

    await expect(host.startProcess(container)).resolves.toBeUndefined();
    expect(environment.OPENCANDLE_PROVIDER_RELAY_URL).toBeUndefined();
    expect(environment.OPENCANDLE_PROVIDER_RELAY_TOKEN).toBeUndefined();
    expect(environment.OPENCANDLE_PROVIDER_RELAY_ATTESTATION_TOKEN).toBeUndefined();
  });

  it("tears down a partially created WebContainer when boot fails", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("location", { origin: "https://web.opencandle.app" });
    const teardown = vi.fn(async () => {});
    const host = createBrowserRuntimeHost({
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: {},
      relayUrl: "",
    });
    host.boot = vi.fn(async () => {
      host.container = { teardown };
      throw new Error("asset failed");
    });

    await expect(host.ensureBooted()).rejects.toThrow("asset failed");
    expect(teardown).toHaveBeenCalledOnce();
    expect(host.container).toBeNull();
    expect(host.bootPromise).toBeNull();
  });

  it("ignores superseded exits and fully resets the runtime that actually exits", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("location", { origin: "https://web.opencandle.app" });
    let resolveExit = (_code: number) => {};
    const teardown = vi.fn(async () => {});
    const host = createBrowserRuntimeHost({
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: {},
      relayUrl: "",
    });
    const process = {
      input: new WritableStream(),
      output: new ReadableStream({
        start(controller) {
          queueMicrotask(() => {
            controller.enqueue(
              `@@OPENCANDLE@@${JSON.stringify({
                type: "ready",
                runtimeEpoch: host.runtimeEpoch,
              })}\n`,
            );
          });
        },
      }),
      exit: new Promise<number>((resolve) => {
        resolveExit = resolve;
      }),
      kill: vi.fn(),
    };
    const container = { spawn: vi.fn(async () => process), teardown };
    host.container = container;

    await host.startProcess(container);
    const runtimeEpoch = host.runtimeEpoch;
    const reject = vi.fn();
    host.pendingRequests.set("old-request", {
      runtimeEpoch,
      timer: 0,
      reject,
    });
    resolveExit(1);

    await vi.waitFor(() => expect(host.process).toBeNull());
    expect(reject).toHaveBeenCalledOnce();
    expect(host.pendingRequests.has("old-request")).toBe(false);
    expect(host.processWriter).toBeNull();
    expect(host.runtimeEpoch).toBe("");
    expect(teardown).toHaveBeenCalledOnce();
  });

  it("fails closed when configured with a cross-origin production relay", () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("location", { origin: "https://web.opencandle.app" });

    const host = createBrowserRuntimeHost({
      bridgeFrame: {},
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: {},
      relayUrl: "https://relay.example/v1/provider-fetch",
    });

    expect(host.relayUrl).toBe("");
  });
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}
