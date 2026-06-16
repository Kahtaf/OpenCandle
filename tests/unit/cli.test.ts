import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const piMocks = vi.hoisted(() => ({
  addSourceToSettings: vi.fn(),
  install: vi.fn(),
  remove: vi.fn(),
  removeSourceFromSettings: vi.fn(),
  spawn: vi.fn(),
  setProgressCallback: vi.fn(),
  update: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    spawn: piMocks.spawn.mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    }),
  };
});

vi.mock("@earendil-works/pi-coding-agent", () => ({
  AuthStorage: { create: vi.fn() },
  DefaultPackageManager: vi.fn(function () {
    return {
      addSourceToSettings: piMocks.addSourceToSettings,
      getInstalledPath: vi.fn(),
      install: piMocks.install,
      remove: piMocks.remove,
      removeSourceFromSettings: piMocks.removeSourceFromSettings,
      setProgressCallback: piMocks.setProgressCallback,
      update: piMocks.update,
    };
  }),
  InteractiveMode: vi.fn(),
  ModelRegistry: { create: vi.fn() },
  SettingsManager: {
    create: vi.fn(() => ({
      getGlobalSettings: vi.fn(() => ({ packages: [] })),
      getProjectSettings: vi.fn(() => ({ packages: [] })),
      getTheme: vi.fn(),
    })),
  },
  createAgentSessionRuntime: vi.fn(),
  createAgentSessionServices: vi.fn(),
  getAgentDir: vi.fn(() => "/tmp/opencandle-test-agent"),
  initTheme: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
  loadEnv: vi.fn(),
}));

vi.mock("../../src/pi/session.js", () => ({
  createOpenCandleSession: vi.fn(),
}));

vi.mock("../../src/pi/session-storage.js", () => ({
  continueOpenCandleSession: vi.fn(),
}));

vi.mock("../../src/onboarding/provider-status.js", () => ({
  formatProviderStatus: vi.fn((status: { providerId: string }) => `${status.providerId}: ok`),
  probeAllProviderStatuses: vi.fn(() => Promise.resolve([{ providerId: "twitter" }])),
}));

const originalArgv = process.argv;
const originalExitCode = process.exitCode;

async function runCli(args: string[]): Promise<void> {
  vi.resetModules();
  process.argv = ["node", "opencandle", ...args];
  process.exitCode = undefined;
  await import("../../src/cli.js");
}

describe("opencandle package commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    piMocks.install.mockResolvedValue(undefined);
    piMocks.remove.mockResolvedValue(undefined);
    piMocks.removeSourceFromSettings.mockReturnValue(true);
    piMocks.update.mockResolvedValue(undefined);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
  });

  it.each(["--local", "-l"])("passes %s through to package installs", async (localFlag) => {
    await runCli(["install", "./fixture-package", localFlag]);

    expect(piMocks.install).toHaveBeenCalledWith("./fixture-package", {
      local: true,
    });
    expect(piMocks.addSourceToSettings).toHaveBeenCalledWith("./fixture-package", {
      local: true,
    });
  });

  it("spawns the foreground local automation monitor", async () => {
    await runCli(["monitor", "--once"]);

    expect(piMocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([
        expect.stringContaining("tsx"),
        expect.stringContaining("src/monitor.ts"),
        "--once",
      ]),
      expect.objectContaining({
        stdio: "inherit",
      }),
    );
    expect(process.exitCode).toBe(0);
  });

  it("prints provider status for doctor without starting the TUI", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["doctor"]);

    expect(log).toHaveBeenCalledWith("OpenCandle provider status");
    expect(log).toHaveBeenCalledWith("  twitter: ok");
  });
});
