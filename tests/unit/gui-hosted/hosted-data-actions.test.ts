// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createHostedDataActions } from "../../../gui/hosted/src/hosted-data-actions.js";
import { createBrowserRuntimeHost } from "../../../gui/hosted/src/runtime/browser-runtime-host.js";

type Command = { type: string; archive?: string };

function fakeHost(handle: (command: Command) => unknown = () => ({})) {
  const commands: Command[] = [];
  return {
    commands,
    host: {
      handleCommand: async (command: Command) => {
        commands.push(command);
        return handle(command);
      },
    },
  };
}

function fakeEnv(overrides: Record<string, unknown> = {}) {
  const clicked: Array<{ href: string; download: string }> = [];
  const revoked: string[] = [];
  return {
    clicked,
    revoked,
    env: {
      reload: vi.fn(),
      now: () => new Date("2026-08-06T00:00:00.000Z"),
      url: {
        createObjectURL: () => "blob:archive",
        revokeObjectURL: (value: string) => revoked.push(value),
      },
      document: {
        createElement: () => {
          const link = {
            href: "",
            download: "",
            click: () => clicked.push({ href: link.href, download: link.download }),
          };
          return link;
        },
      },
      ...overrides,
    },
  };
}

describe("hosted data actions", () => {
  it("downloads the exported archive under a dated file name", async () => {
    const { host, commands } = fakeHost(() => ({ archive: '{"version":7}' }));
    const { env, clicked, revoked } = fakeEnv();

    await createHostedDataActions(host, env).exportData();

    expect(commands).toEqual([{ type: "hosted.data.export" }]);
    expect(clicked).toEqual([
      { href: "blob:archive", download: "opencandle-hosted-2026-08-06.json" },
    ]);
    expect(revoked).toEqual(["blob:archive"]);
  });

  it("does not download anything when the runtime returns no archive", async () => {
    const { host } = fakeHost(() => ({}));
    const { env, clicked } = fakeEnv();

    await createHostedDataActions(host, env).exportData();

    expect(clicked).toEqual([]);
  });

  it("imports a validated archive and reloads", async () => {
    const { host, commands } = fakeHost();
    const { env } = fakeEnv();
    const file = { text: async () => '{"version":7}' };

    await createHostedDataActions(host, env).importData(file);

    expect(commands).toEqual([{ type: "hosted.data.import", archive: '{"version":7}' }]);
    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  it("ignores an import with no file and never reloads", async () => {
    const { host, commands } = fakeHost();
    const { env } = fakeEnv();

    await createHostedDataActions(host, env).importData(null);

    expect(commands).toEqual([]);
    expect(env.reload).not.toHaveBeenCalled();
  });

  it("clears secrets without reloading and clears all with a reload", async () => {
    const { host, commands } = fakeHost();
    const { env } = fakeEnv();
    const actions = createHostedDataActions(host, env);

    await actions.clearSecrets();
    expect(commands).toEqual([{ type: "hosted.data.clear_secrets" }]);
    expect(env.reload).not.toHaveBeenCalled();

    await actions.clearAll();
    expect(commands.at(-1)).toEqual({ type: "hosted.data.clear_all" });
    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  it("activates a waiting worker only after the runtime saves its work", async () => {
    const posted: unknown[] = [];
    const waiting = { postMessage: (message: unknown) => posted.push(message) };

    const ready = fakeHost(() => ({ ready: true }));
    expect(await createHostedDataActions(ready.host, fakeEnv().env).installUpdate(waiting)).toBe(
      true,
    );
    expect(ready.commands).toEqual([{ type: "hosted.runtime.prepare_update" }]);
    expect(posted).toEqual([{ type: "ACTIVATE_UPDATE" }]);

    const notReady = fakeHost(() => ({ ready: false }));
    expect(await createHostedDataActions(notReady.host, fakeEnv().env).installUpdate(waiting)).toBe(
      false,
    );
    expect(posted).toHaveLength(1);

    const noWorker = fakeHost(() => ({ ready: true }));
    expect(await createHostedDataActions(noWorker.host, fakeEnv().env).installUpdate(null)).toBe(
      false,
    );
    expect(noWorker.commands).toEqual([]);
  });

  it("lets a failing command reach the caller so the surface can report it", async () => {
    const host = {
      handleCommand: async () => {
        throw new Error("Unsupported hosted archive version");
      },
    };

    await expect(
      createHostedDataActions(host, fakeEnv().env).importData({ text: async () => "{}" }),
    ).rejects.toThrow("Unsupported hosted archive version");
  });
});

describe("hosted clear all runtime lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reloads after a successful clear without waiting on an eager runtime boot", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const boot = vi.fn(() => new Promise<never>(() => {}));
    const clearDurableData = vi.fn(async () => {});
    const host = createBrowserRuntimeHost({
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: { clearAll: clearDurableData },
      WebContainerImpl: { boot },
    });
    const { env } = fakeEnv();
    const actions = createHostedDataActions(host, env);

    // The durable clear is complete, but a fresh WebContainer boot is held.
    // Clearing on this device must still reach the reload that gives the user
    // an empty, key-free profile; the next boot belongs to that reload.
    const outcome = await Promise.race([
      actions.clearAll().then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("held"), 1_000)),
    ]);

    expect(outcome).toBe("settled");
    expect(clearDurableData).toHaveBeenCalledTimes(1);
    expect(env.reload).toHaveBeenCalledTimes(1);
    expect(boot).not.toHaveBeenCalled();
    expect(host.bootPromise).toBeNull();
  });

  it("does not reload when the durable clear fails", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const host = createBrowserRuntimeHost({
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
      dataStore: {
        clearAll: vi.fn(async () => {
          throw new Error("Browser storage is unavailable");
        }),
      },
      WebContainerImpl: { boot: vi.fn(() => new Promise<never>(() => {})) },
    });
    const { env } = fakeEnv();
    const actions = createHostedDataActions(host, env);

    await expect(actions.clearAll()).rejects.toThrow("Browser storage is unavailable");
    expect(env.reload).not.toHaveBeenCalled();
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, String(value));
    },
  } as Storage;
}
