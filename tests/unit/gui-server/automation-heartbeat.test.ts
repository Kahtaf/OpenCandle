import { describe, expect, it, vi } from "vitest";
import {
  createAutomationHeartbeatRunner,
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
});
