// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createHostedDataActions } from "../../../gui/hosted/src/hosted-data-actions.js";

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
