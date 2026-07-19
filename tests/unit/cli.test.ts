import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const piMocks = vi.hoisted(() => ({
  addSourceToSettings: vi.fn(),
  assertSupportedNodeVersion: vi.fn(),
  buildDoctorReport: vi.fn(),
  createAgentSessionRuntime: vi.fn(),
  createOpenCandleSession: vi.fn(),
  ensureOpenCandleNativeDependencies: vi.fn(),
  install: vi.fn(),
  InteractiveMode: vi.fn(),
  continueOpenCandleSession: vi.fn(),
  acquireSessionWriterLock: vi.fn(),
  migrateWriterLockScope: vi.fn(),
  refreshSessionWriterLock: vi.fn(),
  releaseSessionWriterLock: vi.fn(),
  startTuiSessionCoordinatorServer: vi.fn(),
  writerLockScopeForSession: vi.fn(),
  existsSync: vi.fn(),
  remove: vi.fn(),
  removeSourceFromSettings: vi.fn(),
  renderDoctorReport: vi.fn(),
  spawn: vi.fn(),
  setProgressCallback: vi.fn(),
  update: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: piMocks.existsSync,
  };
});

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

vi.mock("@earendil-works/pi-coding-agent", () => {
  function DefaultPackageManagerMock() {
    return {
      addSourceToSettings: piMocks.addSourceToSettings,
      getInstalledPath: vi.fn(),
      install: piMocks.install,
      remove: piMocks.remove,
      removeSourceFromSettings: piMocks.removeSourceFromSettings,
      setProgressCallback: piMocks.setProgressCallback,
      update: piMocks.update,
    };
  }

  function ModelRegistryMock() {
    return {
      find: vi.fn(),
      getAvailable: vi.fn(() => []),
      hasConfiguredAuth: vi.fn(() => false),
      refresh: vi.fn(),
    };
  }

  return {
    DefaultPackageManager: vi.fn(DefaultPackageManagerMock),
    InteractiveMode: piMocks.InteractiveMode,
    ModelRegistry: vi.fn(ModelRegistryMock),
    ModelRuntime: {
      create: vi.fn(async () => ({
        hasConfiguredAuth: vi.fn(() => false),
      })),
    },
    SettingsManager: {
      create: vi.fn(() => ({
        getDefaultModel: vi.fn(),
        getDefaultProvider: vi.fn(),
        getGlobalSettings: vi.fn(() => ({ packages: [] })),
        getProjectSettings: vi.fn(() => ({ packages: [] })),
        getTheme: vi.fn(),
      })),
    },
    createAgentSessionRuntime: piMocks.createAgentSessionRuntime,
    createAgentSessionServices: vi.fn(),
    getAgentDir: vi.fn(() => "/tmp/opencandle-test-agent"),
    initTheme: vi.fn(),
  };
});

vi.mock("../../src/config.js", () => ({
  loadEnv: vi.fn(),
}));

vi.mock("../../src/infra/native-dependencies.js", () => ({
  ensureOpenCandleNativeDependencies: piMocks.ensureOpenCandleNativeDependencies,
}));

vi.mock("../../src/infra/node-version.js", () => ({
  assertSupportedNodeVersion: piMocks.assertSupportedNodeVersion,
  getUnsupportedNodeVersionMessage: vi.fn(() => null),
}));

vi.mock("../../src/doctor/report.js", () => ({
  buildDoctorReport: piMocks.buildDoctorReport.mockImplementation(() =>
    Promise.resolve({
      schemaVersion: 1,
      generatedAt: "2026-06-22T12:00:00.000Z",
      status: "degraded",
      summary: "doctor summary",
      sections: [],
      metadata: {
        cwd: "/repo",
        opencandleHome: "/tmp/opencandle",
        opencandleHomeSource: "default",
      },
    }),
  ),
}));

vi.mock("../../src/doctor/render.js", () => ({
  renderDoctorReport: piMocks.renderDoctorReport.mockReturnValue("rendered doctor report"),
}));

vi.mock("../../src/pi/session.js", () => ({
  createOpenCandleSession: piMocks.createOpenCandleSession,
}));

vi.mock("../../src/pi/session-storage.js", () => ({
  continueOpenCandleSession: piMocks.continueOpenCandleSession,
}));

vi.mock("../../src/pi/session-writer-lock.js", () => ({
  acquireSessionWriterLock: piMocks.acquireSessionWriterLock,
  migrateWriterLockScope: piMocks.migrateWriterLockScope,
  refreshSessionWriterLock: piMocks.refreshSessionWriterLock,
  releaseSessionWriterLock: piMocks.releaseSessionWriterLock,
  writerLockScopeForSession: piMocks.writerLockScopeForSession,
}));

vi.mock("../../src/pi/tui-session-coordinator.js", () => ({
  startTuiSessionCoordinatorServer: piMocks.startTuiSessionCoordinatorServer,
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
    piMocks.ensureOpenCandleNativeDependencies.mockResolvedValue(undefined);
    piMocks.existsSync.mockReturnValue(false);
    piMocks.acquireSessionWriterLock.mockResolvedValue({
      role: "writer",
      lock: {
        pid: process.pid,
        processKind: "tui",
        acquiredAt: "2026-06-25T12:00:00.000Z",
        lastHeartbeat: "2026-06-25T12:00:00.000Z",
      },
    });
    piMocks.migrateWriterLockScope.mockReturnValue(true);
    piMocks.startTuiSessionCoordinatorServer.mockResolvedValue({
      endpoint: "http://127.0.0.1:24000",
      secret: "test-secret",
      close: vi.fn().mockResolvedValue(undefined),
    });
    piMocks.writerLockScopeForSession.mockReturnValue("/tmp/session.jsonl");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
    expect(piMocks.assertSupportedNodeVersion).toHaveBeenCalled();
    expect(piMocks.ensureOpenCandleNativeDependencies).toHaveBeenCalled();
  });

  it("spawns the compiled foreground local automation monitor when built", async () => {
    piMocks.existsSync.mockImplementation((path) => String(path).endsWith("dist/monitor.js"));

    await runCli(["monitor", "--once"]);

    expect(piMocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringContaining("dist/monitor.js"), "--once"],
      expect.objectContaining({
        stdio: "inherit",
      }),
    );
    expect(process.exitCode).toBe(0);
  });

  it("spawns the source foreground local automation monitor in clean checkouts", async () => {
    await runCli(["monitor", "--once"]);

    expect(piMocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      [
        expect.stringContaining("node_modules/tsx/dist/cli.mjs"),
        expect.stringContaining("src/monitor.ts"),
        "--once",
      ],
      expect.objectContaining({
        stdio: "inherit",
      }),
    );
    expect(process.exitCode).toBe(0);
  });

  it("prints doctor health for doctor without starting the TUI", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["doctor"]);

    expect(log).toHaveBeenCalledWith("rendered doctor report");
    expect(piMocks.assertSupportedNodeVersion).not.toHaveBeenCalled();
    expect(piMocks.ensureOpenCandleNativeDependencies).not.toHaveBeenCalled();
  });

  it.each([
    ["blocked", 1],
    ["degraded", 0],
    ["ready", 0],
  ] as const)("exits %i for a %s doctor report", async (status, expectedExitCode) => {
    piMocks.buildDoctorReport.mockResolvedValueOnce({
      schemaVersion: 1,
      generatedAt: "2026-06-22T12:00:00.000Z",
      status,
      summary: "doctor summary",
      sections: [],
      metadata: {
        cwd: "/repo",
        opencandleHome: "/tmp/opencandle",
        opencandleHomeSource: "default",
      },
    });

    await runCli(["doctor"]);

    expect(process.exitCode ?? 0).toBe(expectedExitCode);
  });

  it("prints structured JSON for doctor --json", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["doctor", "--json"]);

    const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(payload.schemaVersion).toBe(1);
    expect(payload.status).toBe("degraded");
  });

  it("passes explicit doctor scope flags to the shared report builder", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await runCli(["doctor", "--sessions", "--full", "--json"]);

    expect(piMocks.buildDoctorReport).toHaveBeenCalledWith(
      expect.objectContaining({
        includeSessions: true,
        includeGui: true,
      }),
    );
    expect(error).toHaveBeenCalledWith(
      "Session checks may read browser cookies or trigger platform permission prompts for Reddit and X/Twitter.",
    );
  });

  it("clears a skipped provider preference from doctor", async () => {
    const home = mkdtempSync(join(tmpdir(), "opencandle-cli-"));
    vi.stubEnv("OPENCANDLE_HOME", home);
    const { loadOnboardingState, markProviderNeverAsk, saveOnboardingState } = await import(
      "../../src/onboarding/state.js"
    );
    saveOnboardingState(markProviderNeverAsk({ version: 2, providers: {} }, "reddit"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["doctor", "--enable", "reddit"]);

    expect(log).toHaveBeenCalledWith("Re-enabled reddit.");
    expect(loadOnboardingState().providers.reddit).toBeUndefined();

    rmSync(home, { recursive: true, force: true });
  });

  it("acquires and releases the TUI session writer lock for interactive mode", async () => {
    const sessionManager = {
      getSessionFile: vi.fn(() => "/tmp/session.jsonl"),
      getSessionDir: vi.fn(() => "/tmp/sessions"),
    };
    const runtime = {
      dispose: vi.fn().mockResolvedValue(undefined),
      modelFallbackMessage: undefined,
      setRebindSession: vi.fn(),
    };
    const run = vi.fn().mockResolvedValue(undefined);
    piMocks.continueOpenCandleSession.mockReturnValue(sessionManager);
    piMocks.createAgentSessionRuntime.mockResolvedValue(runtime);
    piMocks.InteractiveMode.mockImplementation(function InteractiveModeMock() {
      return { run };
    });

    await runCli([]);

    expect(piMocks.writerLockScopeForSession).toHaveBeenCalledWith(sessionManager);
    expect(piMocks.acquireSessionWriterLock).toHaveBeenCalledWith("/tmp/session.jsonl", "tui", {
      coordinatorEndpoint: "http://127.0.0.1:24000",
      coordinatorSecret: "test-secret",
    });
    expect(run).toHaveBeenCalled();
    expect(piMocks.releaseSessionWriterLock).toHaveBeenCalledWith("/tmp/session.jsonl");
    expect(runtime.dispose).toHaveBeenCalled();
  });

  it("rebinds the TUI session writer lock when interactive mode switches sessions", async () => {
    let rebindSession:
      | ((nextSession: {
          sessionManager: { getSessionFile: () => string; getSessionDir: () => string };
        }) => Promise<void>)
      | undefined;
    const initialSessionManager = {
      getSessionFile: vi.fn(() => "/tmp/session-a.jsonl"),
      getSessionDir: vi.fn(() => "/tmp/sessions"),
    };
    const nextSessionManager = {
      getSessionFile: vi.fn(() => "/tmp/session-b.jsonl"),
      getSessionDir: vi.fn(() => "/tmp/sessions"),
    };
    const runtime = {
      dispose: vi.fn().mockResolvedValue(undefined),
      modelFallbackMessage: undefined,
      setRebindSession: vi.fn((handler) => {
        rebindSession = handler;
      }),
    };
    const run = vi.fn(async () => {
      await rebindSession?.({ sessionManager: nextSessionManager });
    });
    piMocks.continueOpenCandleSession.mockReturnValue(initialSessionManager);
    piMocks.writerLockScopeForSession.mockImplementation((manager) =>
      manager === nextSessionManager ? "/tmp/session-b.jsonl" : "/tmp/session-a.jsonl",
    );
    piMocks.createAgentSessionRuntime.mockResolvedValue(runtime);
    piMocks.InteractiveMode.mockImplementation(function InteractiveModeMock() {
      return { run };
    });

    await runCli([]);

    expect(runtime.setRebindSession).toHaveBeenCalledOnce();
    expect(piMocks.acquireSessionWriterLock).toHaveBeenNthCalledWith(
      1,
      "/tmp/session-a.jsonl",
      "tui",
      {
        coordinatorEndpoint: "http://127.0.0.1:24000",
        coordinatorSecret: "test-secret",
      },
    );
    expect(piMocks.acquireSessionWriterLock).toHaveBeenNthCalledWith(
      2,
      "/tmp/session-b.jsonl",
      "tui",
      {
        coordinatorEndpoint: "http://127.0.0.1:24000",
        coordinatorSecret: "test-secret",
      },
    );
    expect(piMocks.releaseSessionWriterLock).toHaveBeenNthCalledWith(1, "/tmp/session-a.jsonl");
    expect(piMocks.releaseSessionWriterLock).toHaveBeenNthCalledWith(2, "/tmp/session-b.jsonl");
  });

  it("uses neutral syncing language when the TUI cannot coordinate the session", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const close = vi.fn().mockResolvedValue(undefined);
    piMocks.startTuiSessionCoordinatorServer.mockResolvedValue({
      endpoint: "http://127.0.0.1:24000",
      secret: "test-secret",
      close,
    });
    piMocks.acquireSessionWriterLock.mockResolvedValue({
      role: "follower",
      lock: {
        pid: 123,
        processKind: "gui",
        acquiredAt: "2026-06-25T12:00:00.000Z",
        lastHeartbeat: "2026-06-25T12:00:00.000Z",
      },
    });
    piMocks.continueOpenCandleSession.mockReturnValue({
      getSessionFile: vi.fn(() => "/tmp/session.jsonl"),
      getSessionDir: vi.fn(() => "/tmp/sessions"),
    });

    await runCli([]);

    expect(error).toHaveBeenCalledWith(
      "OpenCandle is syncing this session in another window. Try again shortly.",
    );
    expect(close).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("does not silently succeed for a non-interactive non-owner TUI", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const close = vi.fn().mockResolvedValue(undefined);
    piMocks.startTuiSessionCoordinatorServer.mockResolvedValue({
      endpoint: "http://127.0.0.1:24000",
      secret: "test-secret",
      close,
    });
    piMocks.acquireSessionWriterLock.mockResolvedValue({
      role: "follower",
      lock: {
        pid: 123,
        processKind: "gui",
        acquiredAt: "2026-06-25T12:00:00.000Z",
        lastHeartbeat: "2026-06-25T12:00:00.000Z",
        coordinatorEndpoint: "http://127.0.0.1:25000",
        coordinatorSecret: "owner-secret",
      },
    });
    piMocks.continueOpenCandleSession.mockReturnValue({
      getSessionId: vi.fn(() => "session-1"),
      getSessionFile: vi.fn(() => "/tmp/session.jsonl"),
      getSessionDir: vi.fn(() => "/tmp/sessions"),
    });

    await runCli([]);

    expect(error).toHaveBeenCalledWith(
      "OpenCandle is syncing this session in another window. Try again shortly.",
    );
    expect(close).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("prints proxied TUI message content arrays", () => {
    const source = readFileSync(resolve("src/cli-main.ts"), "utf-8");
    const helperStart = source.indexOf("function sseEventText");
    const helperSource = source.slice(helperStart, source.indexOf("await main();", helperStart));

    expect(helperSource).toContain("event.content");
    expect(helperSource).toContain('part.type === "text"');
    expect(helperSource).toContain(".map((part) => part.text)");
  });

  it("fails closed when TUI writer lock scope migration loses ownership", () => {
    const source = readFileSync(resolve("src/cli-main.ts"), "utf-8");
    const syncStart = source.indexOf("function syncActiveSessionWriterLockScope");
    const heartbeatStart = source.indexOf("const writerLockHeartbeat = setInterval", syncStart);
    const syncBlock = source.slice(syncStart, heartbeatStart);
    const heartbeatBlock = source.slice(
      heartbeatStart,
      source.indexOf("runtime = await createAgentSessionRuntime", heartbeatStart),
    );

    expect(syncBlock).toContain("migrateWriterLockScope");
    expect(syncBlock).toContain("activeSessionWriterLockLost = true");
    expect(syncBlock).toContain("OpenCandle is reconnecting to this session.");
    expect(heartbeatBlock).toContain("clearInterval(writerLockHeartbeat)");
  });
});
