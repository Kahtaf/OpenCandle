import { describe, expect, it, vi } from "vitest";
import { createBrowserRuntimeCoordinator } from "../../../gui/hosted/src/runtime/browser-runtime-coordinator.js";

class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>();
  static messages: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(private readonly name: string) {
    const peers = FakeBroadcastChannel.channels.get(name) ?? new Set();
    peers.add(this);
    FakeBroadcastChannel.channels.set(name, peers);
  }

  postMessage(data: unknown) {
    FakeBroadcastChannel.messages.push(structuredClone(data));
    for (const peer of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer !== this) queueMicrotask(() => peer.onmessage?.({ data: structuredClone(data) }));
    }
  }

  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

class YieldIgnoringBroadcastChannel extends FakeBroadcastChannel {
  postMessage(data: unknown) {
    if (
      data &&
      typeof data === "object" &&
      "type" in data &&
      data.type === "writer-yield-request"
    ) {
      return;
    }
    super.postMessage(data);
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
    removeItem: (key: string) => values.delete(key),
  };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe("browser runtime coordinator", () => {
  it("elects one writer and gives a follower mutation to its initiating tab", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    const calls: unknown[] = [];
    const prewarm = vi.fn();
    const createHost = vi.fn(() => ({
      getModelSetup: () => ({ requirement: "ready", hosted: true }),
      prewarm,
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
    expect(prewarm).toHaveBeenCalledOnce();
    const follower = first.getRole() === "follower" ? first : second;
    await follower.request("gui", { action: "new_session" });
    await settle();
    expect(calls).toEqual([{ action: "bootstrap" }, { action: "new_session" }]);
    expect(follower.getRole()).toBe("writer");

    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("does not clone the durable checkpoint into a follower bootstrap response", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    const options = {
      createHost: () => ({
        request: vi.fn(async () => ({
          sessionId: "session-1",
          sessions: [],
          snapshot: {},
          checkpoint: { sessions: [{ content: "durable-session-data" }] },
        })),
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

    await expect(follower.request("gui", { action: "bootstrap" })).resolves.toMatchObject({
      sessionId: "session-1",
      sessions: [],
      snapshot: {},
    });
    await expect(follower.request("gui", { action: "bootstrap" })).resolves.not.toHaveProperty(
      "checkpoint",
    );

    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("uses the durable writer hint when a new follower misses the status handshake", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    const options = {
      createHost: () => ({
        request: vi.fn(async () => ({ sessionId: "session-1", sessions: [], snapshot: {} })),
        handleCommand: vi.fn(),
        dispose: vi.fn(),
      }),
      lockManager: locks,
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage,
      requestTimeoutMs: 1_000,
    };
    const writer = createBrowserRuntimeCoordinator(options);
    await writer.ready();

    const follower = createBrowserRuntimeCoordinator({
      ...options,
      channelFactory: (name: string) => {
        const channel = new FakeBroadcastChannel(name);
        let listener: ((event: { data: unknown }) => void) | null = null;
        Object.defineProperty(channel, "onmessage", {
          configurable: true,
          get: () => listener,
          set: (next) => {
            listener = (event) => {
              if (
                event.data &&
                typeof event.data === "object" &&
                "type" in event.data &&
                event.data.type === "writer-status"
              ) {
                return;
              }
              next?.(event);
            };
          },
        });
        return channel;
      },
    });
    await follower.ready();

    await expect(follower.request("gui", { action: "bootstrap" })).resolves.toMatchObject({
      sessionId: "session-1",
    });
    expect(follower.getRole()).toBe("follower");

    await Promise.all([writer.dispose(), follower.dispose()]);
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

  it("does not hand a session-only credential to an independently opened follower", async () => {
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
    expect(createHost).toHaveBeenLastCalledWith({ sessionCredential: null });
    expect(JSON.stringify(FakeBroadcastChannel.messages)).not.toContain("session-only-key");
    await follower.dispose();
  });

  it("never sends credentials in response to an unauthenticated hello", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    const options = {
      createHost: () => ({
        request: vi.fn(),
        handleCommand: vi.fn(),
        getSessionCredential: () => ({
          version: 2,
          credentials: {
            openai: { apiKey: "session-only-key", storageMode: "session" },
          },
        }),
        dispose: vi.fn(),
      }),
      lockManager: locks,
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage,
    };
    const writer = createBrowserRuntimeCoordinator(options);
    await writer.ready();
    FakeBroadcastChannel.messages = [];

    const attacker = new FakeBroadcastChannel("opencandle-hosted-coordination-v1");
    attacker.postMessage({
      channel: "opencandle-hosted-coordination-v1",
      from: "attacker-controlled-tab",
      type: "hello",
    });
    await settle();

    expect(JSON.stringify(FakeBroadcastChannel.messages)).not.toContain("session-only-key");
    expect(FakeBroadcastChannel.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "session-credential" })]),
    );

    attacker.close();
    await writer.dispose();
  });

  it("purges session credentials from every open tab", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    const firstSession = createStorage();
    const secondSession = createStorage();
    firstSession.setItem(
      "opencandle.hosted.credentials.v1",
      JSON.stringify({
        version: 2,
        credentials: { openai: { apiKey: "first", storageMode: "session" } },
      }),
    );
    secondSession.setItem(
      "opencandle.hosted.credentials.v1",
      JSON.stringify({
        version: 2,
        credentials: { openai: { apiKey: "second", storageMode: "session" } },
      }),
    );
    const base = {
      createHost: () => ({
        request: vi.fn(),
        streamRequest: vi.fn(),
        handleCommand: vi.fn(async () => ({ cleared: true })),
        dispose: vi.fn(),
      }),
      lockManager: locks,
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage,
    };
    const first = createBrowserRuntimeCoordinator({ ...base, sessionStorage: firstSession });
    const second = createBrowserRuntimeCoordinator({ ...base, sessionStorage: secondSession });
    await Promise.all([first.ready(), second.ready()]);
    const follower = first.getRole() === "follower" ? first : second;

    await follower.handleCommand({ type: "hosted.data.clear_secrets" });
    await settle();

    expect(firstSession.getItem("opencandle.hosted.credentials.v1")).toBeNull();
    expect(secondSession.getItem("opencandle.hosted.credentials.v1")).toBeNull();
    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("never broadcasts provider credentials while handing the writer role to a follower", async () => {
    FakeBroadcastChannel.channels.clear();
    FakeBroadcastChannel.messages = [];
    const locks = new FakeLockManager();
    const storage = createStorage();
    const options = {
      createHost: () => ({
        request: vi.fn(),
        handleCommand: vi.fn(async () => ({ configured: true })),
        getModelSetup: vi.fn(() => ({ requirement: "ready", hosted: true })),
        dispose: vi.fn(),
      }),
      lockManager: locks,
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage,
    };
    const first = createBrowserRuntimeCoordinator(options);
    const second = createBrowserRuntimeCoordinator(options);
    await Promise.all([first.ready(), second.ready()]);
    const follower = first.getRole() === "follower" ? first : second;

    await expect(
      follower.handleCommand({
        type: "provider.save_api_key",
        provider: "fred",
        apiKey: "must-stay-in-requesting-tab",
      }),
    ).resolves.toEqual({ configured: true });
    expect(follower.getRole()).toBe("writer");
    expect(JSON.stringify(FakeBroadcastChannel.messages)).not.toContain(
      "must-stay-in-requesting-tab",
    );

    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("forwards a follower model refresh without changing writer ownership", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    const handleCommand = vi.fn(async () => ({ modelSetup: { requirement: "ready" } }));
    const options = {
      createHost: () => ({
        request: vi.fn(),
        handleCommand,
        getModelSetup: vi.fn(() => ({ requirement: "ready", hosted: true })),
        dispose: vi.fn(),
      }),
      lockManager: locks,
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage,
    };
    const first = createBrowserRuntimeCoordinator(options);
    const second = createBrowserRuntimeCoordinator(options);
    await Promise.all([first.ready(), second.ready()]);
    const writer = first.getRole() === "writer" ? first : second;
    const follower = writer === first ? second : first;

    await expect(follower.handleCommand({ type: "model.setup.refresh" })).resolves.toEqual({
      modelSetup: { requirement: "ready" },
    });
    expect(follower.getRole()).toBe("follower");
    expect(writer.getRole()).toBe("writer");
    expect(handleCommand).toHaveBeenCalledWith({ type: "model.setup.refresh" });

    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("promotes the requesting follower through an older waiter before saving locally", async () => {
    FakeBroadcastChannel.channels.clear();
    FakeBroadcastChannel.messages = [];
    const locks = new FakeLockManager();
    const storage = createStorage();
    const hostCommands: Array<ReturnType<typeof vi.fn>> = [];
    const options = {
      createHost: () => {
        const handleCommand = vi.fn(async () => ({ configured: true }));
        hostCommands.push(handleCommand);
        return {
          request: vi.fn(),
          handleCommand,
          getModelSetup: vi.fn(() => ({ requirement: "ready", hosted: true })),
          dispose: vi.fn(),
        };
      },
      lockManager: locks,
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage,
      requestTimeoutMs: 1_000,
    };
    const first = createBrowserRuntimeCoordinator(options);
    const second = createBrowserRuntimeCoordinator(options);
    const requester = createBrowserRuntimeCoordinator(options);
    await Promise.all([first.ready(), second.ready(), requester.ready()]);

    expect(first.getRole()).toBe("writer");
    expect(second.getRole()).toBe("follower");
    expect(requester.getRole()).toBe("follower");

    await expect(
      requester.handleCommand({
        type: "model.setup.save_api_key",
        provider: "openai",
        apiKey: "requesting-tab-only-secret",
      }),
    ).resolves.toEqual({ configured: true });

    expect(requester.getRole()).toBe("writer");
    expect(hostCommands).toHaveLength(3);
    expect(hostCommands[0]).not.toHaveBeenCalled();
    expect(hostCommands[1]).not.toHaveBeenCalled();
    expect(hostCommands[2]).toHaveBeenCalledWith({
      type: "model.setup.save_api_key",
      provider: "openai",
      apiKey: "requesting-tab-only-secret",
    });
    expect(JSON.stringify(FakeBroadcastChannel.messages)).not.toContain(
      "requesting-tab-only-secret",
    );

    await Promise.all([first.dispose(), second.dispose(), requester.dispose()]);
  });

  it("uses only the promoted tab's own session credential", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    const followerSessionStorage = createStorage();
    followerSessionStorage.setItem(
      "opencandle.hosted.credentials.v1",
      JSON.stringify({
        version: 2,
        credentials: {
          openai: { apiKey: "stale-session-key", storageMode: "session" },
        },
      }),
    );
    const createHost = vi.fn((options = {}) => ({
      request: vi.fn(),
      handleCommand: vi.fn(),
      getSessionCredential: () => null,
      dispose: vi.fn(),
      options,
    }));
    const sharedOptions = {
      createHost,
      lockManager: locks,
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage,
    };
    const writer = createBrowserRuntimeCoordinator({
      ...sharedOptions,
      sessionStorage: createStorage(),
    });
    await writer.ready();
    const follower = createBrowserRuntimeCoordinator({
      ...sharedOptions,
      sessionStorage: followerSessionStorage,
    });
    await follower.ready();
    await settle();

    expect(follower.getRole()).toBe("follower");
    await writer.dispose();
    await settle();
    expect(follower.getRole()).toBe("writer");
    expect(createHost).toHaveBeenLastCalledWith({
      sessionCredential: {
        version: 2,
        credentials: {
          openai: { apiKey: "stale-session-key", storageMode: "session" },
        },
      },
    });

    await follower.dispose();
  });

  it("rejects an in-flight forwarded read immediately when the writer epoch changes", async () => {
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

    const forwarded = follower.request("gui", { action: "market_state" });
    await settle();
    await writer.dispose();

    await expect(forwarded).rejects.toThrow("writer changed before the action completed");
    expect(follower.getRole()).toBe("writer");
    await follower.dispose();
  });

  it("retries an in-flight session load with the promoted writer", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    let hostNumber = 0;
    const options = {
      createHost: () => {
        const ownHostNumber = ++hostNumber;
        return {
          request: vi.fn(async () => {
            if (ownHostNumber === 1) return new Promise(() => {});
            return { sessionId: "session-to-load", sessions: [], snapshot: {}, checkpoint: {} };
          }),
          handleCommand: vi.fn(),
          dispose: vi.fn(),
        };
      },
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

    const loading = follower.request("gui", {
      action: "load_session",
      sessionId: "session-to-load",
    });
    await settle();
    await writer.dispose();

    await expect(loading).resolves.toMatchObject({ sessionId: "session-to-load" });
    expect(follower.getRole()).toBe("writer");
    await follower.dispose();
  });

  it("moves a timed-out session load to the visible follower", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    let hostNumber = 0;
    const requests: Array<ReturnType<typeof vi.fn>> = [];
    const options = {
      createHost: () => {
        const ownHostNumber = ++hostNumber;
        const request = vi.fn(async () => {
          if (ownHostNumber === 1) return new Promise(() => {});
          return { sessionId: "session-to-load", sessions: [], snapshot: {}, checkpoint: {} };
        });
        requests.push(request);
        return {
          request,
          handleCommand: vi.fn(),
          dispose: vi.fn(),
        };
      },
      lockManager: locks,
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage,
      requestTimeoutMs: 25,
    };
    const first = createBrowserRuntimeCoordinator(options);
    const second = createBrowserRuntimeCoordinator(options);
    await Promise.all([first.ready(), second.ready()]);
    const writer = first.getRole() === "writer" ? first : second;
    const follower = writer === first ? second : first;

    await expect(
      follower.request("gui", { action: "load_session", sessionId: "session-to-load" }),
    ).resolves.toMatchObject({ sessionId: "session-to-load" });
    expect(follower.getRole()).toBe("writer");
    expect(requests).toHaveLength(2);

    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("moves a timed-out market read to the visible follower", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    let hostNumber = 0;
    const options = {
      createHost: () => {
        const ownHostNumber = ++hostNumber;
        return {
          request: vi.fn(async () => {
            if (ownHostNumber === 1) return new Promise(() => {});
            return { watchlist: [{ symbol: "AAPL" }] };
          }),
          handleCommand: vi.fn(),
          dispose: vi.fn(),
        };
      },
      lockManager: locks,
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage,
      requestTimeoutMs: 25,
    };
    const first = createBrowserRuntimeCoordinator(options);
    const second = createBrowserRuntimeCoordinator(options);
    await Promise.all([first.ready(), second.ready()]);
    const writer = first.getRole() === "writer" ? first : second;
    const follower = writer === first ? second : first;

    await expect(follower.request("gui", { action: "market_state" })).resolves.toEqual({
      watchlist: [{ symbol: "AAPL" }],
    });
    expect(follower.getRole()).toBe("writer");

    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("moves a timed-out read-only command to the visible follower", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    let hostNumber = 0;
    const commands: Array<ReturnType<typeof vi.fn>> = [];
    const options = {
      createHost: () => {
        const ownHostNumber = ++hostNumber;
        const handleCommand = vi.fn(async () => {
          if (ownHostNumber === 1) return new Promise(() => {});
          return { modelSetup: { requirement: "ready" } };
        });
        commands.push(handleCommand);
        return {
          request: vi.fn(async () => ({ sessionId: "session-1", sessions: [], snapshot: {} })),
          handleCommand,
          dispose: vi.fn(),
        };
      },
      lockManager: locks,
      channelFactory: (name: string) => new FakeBroadcastChannel(name),
      storage,
      requestTimeoutMs: 25,
    };
    const first = createBrowserRuntimeCoordinator(options);
    const second = createBrowserRuntimeCoordinator(options);
    await Promise.all([first.ready(), second.ready()]);
    const follower = first.getRole() === "follower" ? first : second;

    await expect(follower.handleCommand({ type: "model.setup.refresh" })).resolves.toEqual({
      modelSetup: { requirement: "ready" },
    });
    expect(follower.getRole()).toBe("writer");
    expect(commands).toHaveLength(2);

    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("replaces a failed writer takeover status instead of leaving switching progress", async () => {
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
      channelFactory: (name: string) => new YieldIgnoringBroadcastChannel(name),
      storage,
      requestTimeoutMs: 25,
    };
    const first = createBrowserRuntimeCoordinator(options);
    const second = createBrowserRuntimeCoordinator(options);
    await Promise.all([first.ready(), second.ready()]);
    const follower = first.getRole() === "follower" ? first : second;
    const progress: unknown[] = [];
    const unsubscribe = follower.subscribe((message) => {
      if (message?.type === "runtime-progress") progress.push(message);
    });

    await expect(
      follower.request("gui", { action: "load_session", sessionId: "session-to-load" }),
    ).rejects.toThrow("did not release the browser runtime");
    expect(progress).toContainEqual(
      expect.objectContaining({
        phase: "error",
        error: "The active hosted tab did not release the browser runtime",
      }),
    );

    unsubscribe();
    await Promise.all([first.dispose(), second.dispose()]);
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

  it("holds the writer lock until asynchronous host teardown completes", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    let finishFirstHostDispose!: () => void;
    const firstHostDisposed = new Promise<void>((resolve) => {
      finishFirstHostDispose = resolve;
    });
    const createHost = vi
      .fn()
      .mockImplementationOnce(() => ({
        request: vi.fn(),
        handleCommand: vi.fn(),
        dispose: vi.fn(() => firstHostDisposed),
      }))
      .mockImplementation(() => ({
        request: vi.fn(),
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
    await first.ready();
    const second = createBrowserRuntimeCoordinator(options);
    await second.ready();

    const disposal = first.dispose();
    await settle();

    expect(createHost).toHaveBeenCalledTimes(1);
    expect(second.getRole()).toBe("follower");

    finishFirstHostDispose();
    await disposal;
    await settle();

    expect(second.getRole()).toBe("writer");
    expect(createHost).toHaveBeenCalledTimes(2);
    await second.dispose();
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

  it("uses an inactivity deadline for forwarded stream chunks", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    let finishStream!: () => void;
    const streamRequest = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("first"));
              finishStream = () => {
                controller.enqueue(new TextEncoder().encode("second"));
                controller.close();
              };
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
      requestTimeoutMs: 30,
    };
    const first = createBrowserRuntimeCoordinator(options);
    const second = createBrowserRuntimeCoordinator(options);
    await Promise.all([first.ready(), second.ready()]);
    const follower = first.getRole() === "follower" ? first : second;
    const response = await follower.streamRequest("gui", { action: "chat_run" });
    const reader = response.body!.getReader();

    const firstChunk = await reader.read();
    expect(new TextDecoder().decode(firstChunk.value)).toBe("first");
    await new Promise((resolve) => setTimeout(resolve, 20));
    finishStream();
    const secondChunk = await reader.read();
    expect(new TextDecoder().decode(secondChunk.value)).toBe("second");
    await expect(reader.read()).resolves.toMatchObject({ done: true });

    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("promotes the initiating follower before it starts a chat stream", async () => {
    FakeBroadcastChannel.channels.clear();
    const locks = new FakeLockManager();
    const storage = createStorage();
    const streamRequest = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("first"));
              controller.close();
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
      requestTimeoutMs: 20,
    };
    const first = createBrowserRuntimeCoordinator(options);
    const second = createBrowserRuntimeCoordinator(options);
    await Promise.all([first.ready(), second.ready()]);
    const follower = first.getRole() === "follower" ? first : second;
    const response = await follower.streamRequest("gui", { action: "chat_run" });
    expect(await response.text()).toBe("first");
    await vi.waitFor(() => expect(follower.getRole()).toBe("writer"));
    expect(streamRequest).toHaveBeenCalledTimes(1);

    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("does not invalidate followers after a read-only forwarded bootstrap", async () => {
    FakeBroadcastChannel.channels.clear();
    FakeBroadcastChannel.messages = [];
    const locks = new FakeLockManager();
    const storage = createStorage();
    const options = {
      createHost: () => ({
        request: vi.fn(async () => ({
          sessionId: "session-1",
          sessions: [],
          snapshot: {},
          checkpoint: {},
        })),
        streamRequest: vi.fn(),
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
    FakeBroadcastChannel.messages = [];

    await follower.request("gui", { action: "bootstrap" });
    await follower.request("gui", { action: "market_quotes" });
    await settle();

    expect(
      FakeBroadcastChannel.messages.filter((message: any) => message.type === "invalidate"),
    ).toHaveLength(0);
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
