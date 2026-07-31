import { describe, expect, it, vi } from "vitest";
import { createBrowserRuntimeCoordinator } from "../../../gui/hosted/src/runtime/browser-runtime-coordinator.js";

class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>();
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(private readonly name: string) {
    const peers = FakeBroadcastChannel.channels.get(name) ?? new Set();
    peers.add(this);
    FakeBroadcastChannel.channels.set(name, peers);
  }

  postMessage(data: unknown) {
    for (const peer of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer !== this) queueMicrotask(() => peer.onmessage?.({ data: structuredClone(data) }));
    }
  }

  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

class FakeLockManager {
  private held = false;
  private queue: Array<(lock: object) => void> = [];

  request(_name: string, callback: (lock: object) => Promise<void>) {
    return new Promise<void>((resolve, reject) => {
      const run = (lock: object) => {
        this.held = true;
        void callback(lock)
          .then(resolve, reject)
          .finally(() => {
            this.held = false;
            const next = this.queue.shift();
            if (next) queueMicrotask(() => next({ name: "writer" }));
          });
      };
      if (this.held) this.queue.push(run);
      else run({ name: "writer" });
    });
  }
}

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe("browser runtime coordinator", () => {
  it("elects one writer and forwards a follower action exactly once", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    const calls: unknown[] = [];
    const createHost = vi.fn(() => ({
      getModelSetup: () => ({ requirement: "ready", hosted: true }),
      request: async (_operation: string, payload: unknown) => {
        calls.push(payload);
        return { sessionId: "session-1", sessions: [], snapshot: {}, checkpoint: {} };
      },
      handleCommand: vi.fn(),
      dispose: vi.fn(),
    }));
    const options = {
      createHost,
      lockManager: locks,
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage,
      requestTimeoutMs: 1_000,
    };
    const first = createBrowserRuntimeCoordinator(options);
    const second = createBrowserRuntimeCoordinator(options);
    await Promise.all([first.ready(), second.ready()]);

    expect([first.getRole(), second.getRole()].sort()).toEqual(["follower", "writer"]);
    expect(createHost).toHaveBeenCalledTimes(1);
    const follower = first.getRole() === "follower" ? first : second;
    await follower.request("gui", { action: "new_session" });
    await settle();
    expect(calls).toEqual([{ action: "new_session" }]);

    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("promotes the follower with a newer epoch and ignores stale responses", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    let hostNumber = 0;
    const options = {
      createHost: () => ({
        request: vi.fn(async () => ({ hostNumber: ++hostNumber })),
        handleCommand: vi.fn(),
        dispose: vi.fn(),
      }),
      lockManager: locks,
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage,
      requestTimeoutMs: 1_000,
    };
    const first = createBrowserRuntimeCoordinator(options);
    const second = createBrowserRuntimeCoordinator(options);
    await Promise.all([first.ready(), second.ready()]);
    const writer = first.getRole() === "writer" ? first : second;
    const follower = writer === first ? second : first;
    const initialEpoch = writer.getEpoch();

    await writer.dispose();
    await settle();
    expect(follower.getRole()).toBe("writer");
    expect(follower.getEpoch()).toBeGreaterThan(initialEpoch);

    await follower.dispose();
  });

  it("hands a session-only credential to an already-open follower before failover", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    const credential = {
      version: 1,
      provider: "openai",
      modelId: "gpt-4.1-mini",
      apiKey: "session-only-key",
      storageMode: "session",
    };
    const createHost = vi.fn((options: { sessionCredential?: typeof credential } = {}) => ({
      request: vi.fn(),
      handleCommand: vi.fn(),
      getSessionCredential: () =>
        options.sessionCredential ?? (createHost.mock.calls.length === 1 ? credential : null),
      dispose: vi.fn(),
    }));
    const options = {
      createHost,
      lockManager: locks,
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage,
    };
    const first = createBrowserRuntimeCoordinator(options);
    const second = createBrowserRuntimeCoordinator(options);
    await Promise.all([first.ready(), second.ready()]);
    await settle();
    const writer = first.getRole() === "writer" ? first : second;
    const follower = writer === first ? second : first;

    await writer.dispose();
    await settle();

    expect(follower.getRole()).toBe("writer");
    expect(createHost).toHaveBeenLastCalledWith({ sessionCredential: credential });
    await follower.dispose();
  });

  it("rejects an in-flight follower action immediately when the writer epoch changes", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    const options = {
      createHost: () => ({
        request: vi.fn(() => new Promise(() => {})),
        handleCommand: vi.fn(),
        dispose: vi.fn(),
      }),
      lockManager: locks,
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage,
      requestTimeoutMs: 10_000,
    };
    const first = createBrowserRuntimeCoordinator(options);
    const second = createBrowserRuntimeCoordinator(options);
    await Promise.all([first.ready(), second.ready()]);
    const writer = first.getRole() === "writer" ? first : second;
    const follower = writer === first ? second : first;

    const forwarded = follower.request("gui", { action: "new_session" });
    await settle();
    await writer.dispose();

    await expect(forwarded).rejects.toThrow("writer changed before the action completed");
    expect(follower.getRole()).toBe("writer");
    await follower.dispose();
  });

  it("tears down the writer host before dispose resolves", async () => {
    FakeBroadcastChannel.channels.clear();
    let finishHostDispose!: () => void;
    const hostDisposed = new Promise<void>((resolve) => {
      finishHostDispose = resolve;
    });
    const disposeHost = vi.fn(() => hostDisposed);
    const coordinator = createBrowserRuntimeCoordinator({
      createHost: () => ({
        request: vi.fn(),
        handleCommand: vi.fn(),
        dispose: disposeHost,
      }),
      lockManager: new FakeLockManager(),
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage: createStorage(),
      requestTimeoutMs: 1_000,
    });
    await coordinator.ready();

    let settled = false;
    const disposal = coordinator.dispose().then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(disposeHost).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    finishHostDispose();
    await disposal;
  });

  it("invalidates hosted subscribers when browser connectivity changes", async () => {
    FakeBroadcastChannel.channels.clear();
    const listeners = new Map<string, Set<() => void>>();
    const eventTarget = {
      addEventListener(type: string, listener: () => void) {
        const entries = listeners.get(type) ?? new Set();
        entries.add(listener);
        listeners.set(type, entries);
      },
      removeEventListener(type: string, listener: () => void) {
        listeners.get(type)?.delete(listener);
      },
      dispatch(type: string) {
        for (const listener of listeners.get(type) ?? []) listener();
      },
    };
    const coordinator = createBrowserRuntimeCoordinator({
      createHost: () => ({ request: vi.fn(), handleCommand: vi.fn(), dispose: vi.fn() }),
      lockManager: new FakeLockManager(),
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage: createStorage(),
      eventTarget,
    });
    await coordinator.ready();
    const subscriber = vi.fn();
    coordinator.subscribe(subscriber);

    eventTarget.dispatch("offline");

    expect(subscriber).toHaveBeenCalledWith(
      expect.objectContaining({ type: "invalidate", reason: "network" }),
    );
    await coordinator.dispose();
  });

  it("preserves the offline read-only role returned by the browser host", async () => {
    FakeBroadcastChannel.channels.clear();
    const coordinator = createBrowserRuntimeCoordinator({
      createHost: () => ({
        request: vi.fn(async () => ({
          role: "offline",
          sessionId: "session-1",
          sessions: [],
          snapshot: {},
          coordination: { writable: false, ownerKind: "offline" },
        })),
        handleCommand: vi.fn(),
        dispose: vi.fn(),
      }),
      lockManager: new FakeLockManager(),
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage: createStorage(),
    });
    await coordinator.ready();

    await expect(coordinator.request("gui", { action: "bootstrap" })).resolves.toMatchObject({
      role: "offline",
      coordination: { writable: false, ownerKind: "offline" },
    });
    await coordinator.dispose();
  });

  it("forwards a writer stream to a follower without buffering the run", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    const streamRequest = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"type":"run.started"}\n\n'));
              queueMicrotask(() => {
                controller.enqueue(new TextEncoder().encode('data: {"type":"run.completed"}\n\n'));
                controller.close();
              });
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const options = {
      createHost: () => ({
        request: vi.fn(),
        streamRequest,
        handleCommand: vi.fn(),
        dispose: vi.fn(),
      }),
      lockManager: locks,
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage,
      requestTimeoutMs: 1_000,
    };
    const first = createBrowserRuntimeCoordinator(options);
    const second = createBrowserRuntimeCoordinator(options);
    await Promise.all([first.ready(), second.ready()]);
    const follower = first.getRole() === "follower" ? first : second;
    const response = await follower.streamRequest("gui", { action: "chat_run" });

    expect(await response.text()).toBe(
      'data: {"type":"run.started"}\n\ndata: {"type":"run.completed"}\n\n',
    );
    expect(streamRequest).toHaveBeenCalledTimes(1);

    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("chunks large writer stream reads before forwarding them to a follower", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    const payload = new Uint8Array(200_000).fill(97);
    const options = {
      createHost: () => ({
        request: vi.fn(),
        streamRequest: vi.fn(
          async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(payload);
                  controller.close();
                },
              }),
              { headers: { "content-type": "text/event-stream" } },
            ),
        ),
        handleCommand: vi.fn(),
        dispose: vi.fn(),
      }),
      lockManager: locks,
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage,
      requestTimeoutMs: 1_000,
    };
    const first = createBrowserRuntimeCoordinator(options);
    const second = createBrowserRuntimeCoordinator(options);
    await Promise.all([first.ready(), second.ready()]);
    const follower = first.getRole() === "follower" ? first : second;

    const response = await follower.streamRequest("gui", { action: "chat_run" });

    expect((await response.arrayBuffer()).byteLength).toBe(payload.byteLength);
    await Promise.all([first.dispose(), second.dispose()]);
  });
});
