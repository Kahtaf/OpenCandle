import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireWriterLock, readWriterLock, releaseWriterLock } from "../../../gui/server/writer-lock.js";

describe("writer lock", () => {
  it("acquires and releases a lock atomically", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-lock-"));
    try {
      const acquired = await acquireWriterLock(dir, "gui", { pid: process.pid, staleGraceMs: 1 });
      expect(acquired.role).toBe("writer");
      expect(readWriterLock(dir)?.processKind).toBe("gui");

      const follower = await acquireWriterLock(dir, "tui", { pid: process.pid, staleGraceMs: 1 });
      expect(follower.role).toBe("follower");

      releaseWriterLock(dir, process.pid);
      expect(readWriterLock(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("recovers stale locks for dead pids", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-lock-"));
    try {
      const first = await acquireWriterLock(dir, "gui", { pid: 99999999, staleGraceMs: 1 });
      expect(first.role).toBe("writer");

      const second = await acquireWriterLock(dir, "gui", { pid: process.pid, staleGraceMs: 1 });
      expect(second.role).toBe("writer");
      expect(readWriterLock(dir)?.pid).toBe(process.pid);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
