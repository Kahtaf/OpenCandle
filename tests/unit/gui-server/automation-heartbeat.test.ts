import { describe, expect, it, vi } from "vitest";
import {
  createAutomationHeartbeatRunner,
  createLocalAutomationHeartbeat,
  DEFAULT_AUTOMATION_HEARTBEAT_MS,
  normalizeAutomationHeartbeatMs,
} from "../../../gui/server/automation-heartbeat.js";

describe("GUI automation heartbeat policy", () => {
  it("falls back to the default interval for invalid or too-small values", () => {
    expect(normalizeAutomationHeartbeatMs(undefined)).toBe(DEFAULT_AUTOMATION_HEARTBEAT_MS);
    expect(normalizeAutomationHeartbeatMs("abc")).toBe(DEFAULT_AUTOMATION_HEARTBEAT_MS);
    expect(normalizeAutomationHeartbeatMs("0")).toBe(DEFAULT_AUTOMATION_HEARTBEAT_MS);
    expect(normalizeAutomationHeartbeatMs("-1000")).toBe(DEFAULT_AUTOMATION_HEARTBEAT_MS);
    expect(normalizeAutomationHeartbeatMs("4999")).toBe(DEFAULT_AUTOMATION_HEARTBEAT_MS);
    expect(normalizeAutomationHeartbeatMs("5000")).toBe(5000);
  });

  it("skips overlapping heartbeat runs and allows the next run after completion", async () => {
    let releaseRun: (() => void) | null = null;
    const run = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseRun = resolve;
      });
    });
    const runner = createAutomationHeartbeatRunner(run);

    const first = runner(false);
    const second = await runner(true);

    expect(second).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);

    releaseRun?.();
    await expect(first).resolves.toBe(true);
    const third = runner(true);
    releaseRun?.();

    await expect(third).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("starts writer heartbeats immediately, repeats on the configured interval, and stops", async () => {
    const intervalHandle = {} as ReturnType<typeof setInterval>;
    let intervalCallback: (() => void) | null = null;
    const setIntervalFn = vi.fn((callback: () => void) => {
      intervalCallback = callback;
      return intervalHandle;
    });
    const clearIntervalFn = vi.fn();
    const db = { close: vi.fn() };
    const initDatabase = vi.fn(() => db);
    const runHeartbeat = vi.fn(async () => {});
    const heartbeat = createLocalAutomationHeartbeat({
      role: "writer",
      getSessionId: () => "session-1",
      intervalMs: 60_000,
      initDatabase,
      runHeartbeat,
      setIntervalFn,
      clearIntervalFn,
    });

    heartbeat.start();
    await vi.waitFor(() => expect(runHeartbeat).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(db.close).toHaveBeenCalledTimes(1));
    intervalCallback?.();
    await vi.waitFor(() => expect(runHeartbeat).toHaveBeenCalledTimes(2));

    expect(runHeartbeat).toHaveBeenCalledWith(db, {
      ownerId: "gui:session-1",
      ownerKind: "writer",
      ttlSeconds: 120,
      checkAlerts: true,
    });
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 60_000);

    heartbeat.stop();

    expect(clearIntervalFn).toHaveBeenCalledWith(intervalHandle);
    expect(db.close).toHaveBeenCalledTimes(2);
  });

  it("warns on heartbeat errors and closes the database handle", async () => {
    const db = { close: vi.fn() };
    const warn = vi.fn();
    const heartbeat = createLocalAutomationHeartbeat({
      role: "writer",
      getSessionId: () => "session-1",
      intervalMs: 5_000,
      initDatabase: () => db,
      runHeartbeat: async () => {
        throw new Error("db locked");
      },
      setIntervalFn: vi.fn(() => ({}) as ReturnType<typeof setInterval>),
      warn,
    });

    heartbeat.start();
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith("Local automation heartbeat failed: db locked"),
    );

    expect(db.close).toHaveBeenCalledOnce();
  });
});
