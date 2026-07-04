import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireWriterLock, readWriterLock } from "../../../gui/server/writer-lock.js";

const DEFAULT_STALE_GRACE_MS = 15_000;

afterEach(() => {
  vi.useRealTimers();
});

describe("writer lock stale-grace recovery", () => {
  it("does not steal a long-running live owner whose heartbeat stalls past stale grace", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T12:00:00.000Z"));

    const dir = mkdtempSync(join(tmpdir(), "opencandle-long-stream-lock-"));
    try {
      const ownerPid = 424_242;
      const contenderPid = 515_151;
      const first = await acquireWriterLock(dir, "gui", {
        pid: ownerPid,
        ownerId: `${ownerPid}:owner-process-start`,
      });
      expect(first.role).toBe("writer");

      writeFileSync(
        join(dir, "writer.lock"),
        JSON.stringify(
          {
            ...first.lock,
            lastHeartbeat: new Date(Date.now() - DEFAULT_STALE_GRACE_MS - 1).toISOString(),
          },
          null,
          2,
        ),
      );

      const liveOwnerAttempt = await acquireWriterLock(dir, "tui", {
        pid: contenderPid,
        ownerId: `${contenderPid}:contender-process-start`,
        isPidAlive: (pid) => pid === ownerPid,
      });

      expect(liveOwnerAttempt.role).toBe("follower");
      expect(liveOwnerAttempt.lock).toMatchObject({
        pid: ownerPid,
        processKind: "gui",
        recoveryState: "ambiguous",
      });
      expect(readWriterLock(dir)).toMatchObject({
        pid: ownerPid,
        processKind: "gui",
      });

      const recovered = acquireWriterLock(dir, "tui", {
        pid: contenderPid,
        ownerId: `${contenderPid}:contender-process-start`,
        isPidAlive: () => false,
      });
      await vi.advanceTimersByTimeAsync(DEFAULT_STALE_GRACE_MS);

      await expect(recovered).resolves.toMatchObject({
        role: "writer",
        lock: {
          pid: contenderPid,
          processKind: "tui",
        },
      });
      expect(readWriterLock(dir)).toMatchObject({
        pid: contenderPid,
        processKind: "tui",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
