import { win32 } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs", () => ({ existsSync: mocks.existsSync }));

import { rebuildNativeDependency } from "../../../src/infra/native-dependencies.js";

const originalPlatform = process.platform;
const originalNpmExecpath = process.env.npm_execpath;

function restorePlatform(): void {
  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
}

function childEmitting(events: Record<string, unknown[]>): {
  on: (event: string, handler: (...args: never[]) => void) => unknown;
} {
  const child = {
    on(event: string, handler: (...args: never[]) => void) {
      if (event in events) handler(...(events[event] as never[]));
      return child;
    },
  };
  return child;
}

beforeEach(() => {
  mocks.spawn.mockReset();
  mocks.existsSync.mockReset();
  delete process.env.npm_execpath;
});

afterEach(() => {
  restorePlatform();
  if (originalNpmExecpath === undefined) {
    delete process.env.npm_execpath;
  } else {
    process.env.npm_execpath = originalNpmExecpath;
  }
});

describe("rebuildNativeDependency", () => {
  it("spawns Node with the npm CLI entrypoint from npm_execpath on Windows", async () => {
    const npmCli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    process.env.npm_execpath = npmCli;
    mocks.existsSync.mockReturnValue(true);
    mocks.spawn.mockReturnValue(childEmitting({ exit: [0] }));

    await rebuildNativeDependency("better-sqlite3");

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      [npmCli, "rebuild", "better-sqlite3"],
      { stdio: "inherit" },
    );
  });

  it("falls back to the Node sibling npm CLI when npm_execpath is absent", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    const npmCli = win32.join(
      win32.dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    mocks.existsSync.mockImplementation((candidate: string) => candidate === npmCli);
    mocks.spawn.mockReturnValue(childEmitting({ exit: [0] }));

    await rebuildNativeDependency("better-sqlite3");

    expect(mocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      [npmCli, "rebuild", "better-sqlite3"],
      { stdio: "inherit" },
    );
  });

  it("fails without spawning when no npm CLI entrypoint exists", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    mocks.existsSync.mockReturnValue(false);

    await expect(rebuildNativeDependency("better-sqlite3")).rejects.toThrow(
      /Cannot locate the npm JavaScript entrypoint on Windows/i,
    );
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("keeps the bare npm rebuild command on POSIX", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    mocks.spawn.mockReturnValue(childEmitting({ exit: [0] }));

    await rebuildNativeDependency("better-sqlite3");

    expect(mocks.spawn).toHaveBeenCalledWith("npm", ["rebuild", "better-sqlite3"], {
      stdio: "inherit",
    });
  });

  it("rejects with the exit code when npm rebuild fails", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    mocks.spawn.mockReturnValue(childEmitting({ exit: [7] }));

    await expect(rebuildNativeDependency("better-sqlite3")).rejects.toThrow(/exit code 7/);
  });

  it("propagates a spawn error", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    mocks.spawn.mockReturnValue(childEmitting({ error: [new Error("spawn failed")] }));

    await expect(rebuildNativeDependency("better-sqlite3")).rejects.toThrow("spawn failed");
  });
});
