import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acquireWriterLock,
  readWriterLock,
  releaseWriterLock,
  writerLockScopeForSession,
} from "../../../gui/server/writer-lock.js";

describe("writer lock", () => {
  it("acquires and releases a lock atomically", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-lock-"));
    try {
      const acquired = await acquireWriterLock(dir, "gui", {
        pid: process.pid,
        staleGraceMs: 1000,
      });
      expect(acquired.role).toBe("writer");
      expect(readWriterLock(dir)?.processKind).toBe("gui");

      const follower = await acquireWriterLock(dir, "tui", {
        pid: process.pid,
        staleGraceMs: 1000,
      });
      expect(follower.role).toBe("follower");

      releaseWriterLock(dir, process.pid);
      expect(readWriterLock(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("scopes locks to individual persisted session files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-lock-"));
    try {
      const sessionA = join(dir, "session-a.jsonl");
      const sessionB = join(dir, "session-b.jsonl");
      writeFileSync(sessionA, "");
      writeFileSync(sessionB, "");

      const first = await acquireWriterLock(sessionA, "gui", {
        pid: process.pid,
        staleGraceMs: 1000,
      });
      const second = await acquireWriterLock(sessionB, "tui", {
        pid: process.pid,
        staleGraceMs: 1000,
      });
      const sameSession = await acquireWriterLock(sessionA, "tui", {
        pid: process.pid,
        staleGraceMs: 1000,
      });

      expect(first.role).toBe("writer");
      expect(second.role).toBe("writer");
      expect(sameSession.role).toBe("follower");
      expect(readWriterLock(sessionA)?.processKind).toBe("gui");
      expect(readWriterLock(sessionB)?.processKind).toBe("tui");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats future session jsonl paths as file-scoped locks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-lock-"));
    try {
      const sessionFile = join(dir, "future-session.jsonl");
      const acquired = await acquireWriterLock(sessionFile, "gui", {
        pid: process.pid,
        staleGraceMs: 1000,
      });

      expect(acquired.role).toBe("writer");
      expect(existsSync(sessionFile)).toBe(false);
      expect(statSync(`${sessionFile}.writer.lock`).isFile()).toBe(true);
      expect(readWriterLock(sessionFile)?.processKind).toBe("gui");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses the session file as the writer-lock scope for persisted sessions", () => {
    const sessionManager = {
      getSessionFile: () => "/tmp/session-1.jsonl",
      getSessionDir: () => "/tmp/sessions",
    };

    expect(writerLockScopeForSession(sessionManager)).toBe("/tmp/session-1.jsonl");
  });

  it("falls back to the session directory for in-memory sessions", () => {
    const sessionManager = {
      getSessionFile: () => undefined,
      getSessionDir: () => "/tmp/sessions",
    };

    expect(writerLockScopeForSession(sessionManager)).toBe("/tmp/sessions");
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

  it("recovers stale locks for live pids when the heartbeat stops", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-lock-"));
    try {
      const first = await acquireWriterLock(dir, "gui", { pid: process.pid, staleGraceMs: 1 });
      expect(first.role).toBe("writer");
      writeFileSync(
        join(dir, "writer.lock"),
        JSON.stringify({
          ...first.lock,
          lastHeartbeat: new Date(Date.now() - 60_000).toISOString(),
        }),
      );

      const second = await acquireWriterLock(dir, "tui", { pid: process.pid, staleGraceMs: 1 });
      expect(second.role).toBe("writer");
      expect(readWriterLock(dir)?.processKind).toBe("tui");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
