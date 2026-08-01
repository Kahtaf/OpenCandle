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

  it("tears down and reboots the runtime after clearing a live model key", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("navigator", { onLine: true });
    const storage = memoryStorage();
    const sessionStorage = memoryStorage();
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

    await expect(host.handleCommand({ type: "hosted.data.clear_secrets" })).resolves.toMatchObject({
      modelSetup: { requirement: "api_key" },
    });

    expect(storage.getItem("opencandle.hosted.credentials.v1")).toBeNull();
    expect(sessionStorage.getItem("opencandle.hosted.credentials.v1")).toBeNull();
    expect(host.stopRuntime).toHaveBeenCalledTimes(1);
    expect(host.ensureBooted).toHaveBeenCalledTimes(1);
    expect(host.request).not.toHaveBeenCalledWith(
      "gui",
      expect.objectContaining({ action: "configure_model" }),
    );
  });

  it("keeps a seeded session credential in memory without persisting it", () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    const storage = memoryStorage();
    const sessionStorage = memoryStorage();
    const credential = {
      version: 1,
      provider: "openai",
      modelId: "gpt-4.1-mini",
      apiKey: "session-only-key",
      storageMode: "session",
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
      supportsAttachments: false,
    });
    expect(storage.getItem("opencandle.hosted.credentials.v1")).toBeNull();
    expect(sessionStorage.getItem("opencandle.hosted.credentials.v1")).toBeNull();
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
    host.fetchAssetText = vi.fn(async () => "runtime");
    host.fetchAssetBytes = vi.fn(async () => new Uint8Array());
    host.startProcess = vi.fn(async () => {});

    await host.boot();
    await host.boot();

    expect(calls).toEqual(["configure", "boot", "boot"]);
  });

  it("passes a stable non-secret relay identity only to the hosted process", async () => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("location", { origin: "https://web.opencandle.app" });
    const storage = memoryStorage();
    const environments: Array<Record<string, string>> = [];
    const run = async () => {
      let ready: ((port: number, url: string) => void) | undefined;
      const container = {
        on: vi.fn((_event, callback) => {
          ready = callback;
          return vi.fn();
        }),
        spawn: vi.fn(async (_command, _args, options) => {
          environments.push(options.env);
          ready?.(Number(options.env.PORT), "https://runtime.example");
          return { kill: vi.fn() };
        }),
      };
      const host = createBrowserRuntimeHost({
        bridgeFrame: {},
        storage,
        sessionStorage: memoryStorage(),
        dataStore: {},
        relayUrl: "https://web.opencandle.app/v1/provider-fetch",
      });
      host.connectBridge = vi.fn(async () => {});
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
    expect(second.OPENCANDLE_PROVIDER_RELAY_CLIENT_ID).toBe(
      first.OPENCANDLE_PROVIDER_RELAY_CLIENT_ID,
    );
    expect(storage.getItem("opencandle.hosted.relay-client.v1")).toBe(
      first.OPENCANDLE_PROVIDER_RELAY_CLIENT_ID,
    );
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
