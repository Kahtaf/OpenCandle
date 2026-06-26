import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("writer lock fd lifecycle", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("closes the exclusive lock file descriptor after writing", async () => {
    const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const closeSync = vi.fn(actualFs.closeSync);
    vi.doMock("node:fs", () => ({ ...actualFs, closeSync }));

    const { acquireWriterLock } = await import("../../../gui/server/writer-lock.js");
    const dir = mkdtempSync(join(tmpdir(), "opencandle-lock-fd-"));

    try {
      const acquired = await acquireWriterLock(dir, "gui", {
        pid: process.pid,
        staleGraceMs: 1000,
      });

      expect(acquired.role).toBe("writer");
      expect(closeSync).toHaveBeenCalledTimes(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
