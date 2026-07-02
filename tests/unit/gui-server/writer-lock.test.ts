import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acquireWriterLock,
  migrateWriterLockScope,
  readWriterLock,
  refreshWriterLock,
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
      expect(readWriterLock(dir)).toMatchObject({
        processKind: "gui",
        protocolVersion: 1,
        scope: dir,
      });
      expect(readWriterLock(dir)?.ownerId).toContain(`${process.pid}:`);

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

  it("records the local coordinator endpoint and capability when provided", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-lock-"));
    try {
      await acquireWriterLock(dir, "gui", {
        coordinatorEndpoint: "http://127.0.0.1:14567",
        coordinatorSecret: "secret-1",
      });

      expect(readWriterLock(dir)).toMatchObject({
        coordinatorEndpoint: "http://127.0.0.1:14567",
        coordinatorSecret: "secret-1",
      });
      expect(statSync(join(dir, "writer.lock")).mode & 0o777).toBe(0o600);
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

  it("does not recover stale locks for live matching owners when the heartbeat stops", async () => {
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
      expect(second.role).toBe("follower");
      expect(readWriterLock(dir)?.processKind).toBe("gui");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not recover ambiguous live locks when process identity is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-lock-"));
    try {
      const first = await acquireWriterLock(dir, "gui", {
        pid: process.pid,
        staleGraceMs: 1,
        ownerId: "",
      });
      expect(first.role).toBe("writer");
      writeFileSync(
        join(dir, "writer.lock"),
        JSON.stringify({
          ...first.lock,
          ownerId: undefined,
          lastHeartbeat: new Date(Date.now() - 60_000).toISOString(),
        }),
      );

      const second = await acquireWriterLock(dir, "tui", { pid: process.pid, staleGraceMs: 1 });
      expect(second.role).toBe("follower");
      expect(second.lock.recoveryState).toBe("ambiguous");
      expect(readWriterLock(dir)?.processKind).toBe("gui");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats stale locks from an unverified live pid as ambiguous instead of current", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-lock-"));
    try {
      const first = await acquireWriterLock(dir, "gui", {
        pid: 123_456,
        ownerId: "123456:old-process-start",
        staleGraceMs: 1,
      });
      expect(first.role).toBe("writer");
      writeFileSync(
        join(dir, "writer.lock"),
        JSON.stringify({
          ...first.lock,
          lastHeartbeat: new Date(Date.now() - 60_000).toISOString(),
        }),
      );

      const second = await acquireWriterLock(dir, "tui", {
        pid: process.pid,
        staleGraceMs: 1,
        isPidAlive: (pid) => pid === 123_456,
      });

      expect(second.role).toBe("follower");
      expect(second.lock.recoveryState).toBe("ambiguous");
      expect(readWriterLock(dir)?.processKind).toBe("gui");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refreshes only locks held by the same owner identity", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-lock-"));
    try {
      const first = await acquireWriterLock(dir, "gui", {
        pid: process.pid,
        ownerId: "owner-a",
      });
      refreshWriterLock(dir, { pid: process.pid, ownerId: "owner-b" });
      expect(readWriterLock(dir)?.lastHeartbeat).toBe(first.lock.lastHeartbeat);

      refreshWriterLock(dir, {
        pid: process.pid,
        ownerId: "owner-a",
        now: () => new Date("2030-01-01T00:00:00.000Z"),
      });
      expect(readWriterLock(dir)?.lastHeartbeat).toBe("2030-01-01T00:00:00.000Z");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("migrates a fallback directory lock to a canonical session file without leaving two owners", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-lock-"));
    try {
      const sessionFile = join(dir, "session.jsonl");
      const first = await acquireWriterLock(dir, "gui", {
        pid: process.pid,
        ownerId: "owner-a",
      });

      const migrated = migrateWriterLockScope(dir, sessionFile, {
        pid: process.pid,
        ownerId: "owner-a",
      });

      expect(migrated).toBe(true);
      expect(readWriterLock(dir)).toBeNull();
      expect(readWriterLock(sessionFile)).toMatchObject({
        ...first.lock,
        scope: sessionFile,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("releases the fallback lock when canonical migration loses the destination race", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-lock-"));
    try {
      const sessionFile = join(dir, "session.jsonl");
      await acquireWriterLock(dir, "gui", {
        pid: process.pid,
        ownerId: "owner-a",
      });
      await acquireWriterLock(sessionFile, "tui", {
        pid: 999_999,
        ownerId: "owner-b",
      });

      expect(
        migrateWriterLockScope(dir, sessionFile, {
          pid: process.pid,
          ownerId: "owner-a",
        }),
      ).toBe(false);

      expect(readWriterLock(dir)).toBeNull();
      expect(readWriterLock(sessionFile)).toMatchObject({
        ownerId: "owner-b",
        scope: sessionFile,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats an existing canonical lock owned by the same process as migrated", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-lock-"));
    try {
      const sessionFile = join(dir, "session.jsonl");
      await acquireWriterLock(dir, "gui", {
        pid: process.pid,
        ownerId: "owner-a",
      });
      await acquireWriterLock(sessionFile, "gui", {
        pid: process.pid,
        ownerId: "owner-a",
      });

      expect(
        migrateWriterLockScope(dir, sessionFile, {
          pid: process.pid,
          ownerId: "owner-a",
        }),
      ).toBe(true);

      expect(readWriterLock(dir)).toBeNull();
      expect(readWriterLock(sessionFile)).toMatchObject({
        ownerId: "owner-a",
        scope: sessionFile,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("migrates locks created with the default owner identity", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-lock-"));
    try {
      const sessionFile = join(dir, "session.jsonl");
      await acquireWriterLock(dir, "gui", {
        pid: process.pid,
      });

      expect(migrateWriterLockScope(dir, sessionFile)).toBe(true);
      expect(readWriterLock(dir)).toBeNull();
      expect(readWriterLock(sessionFile)).toMatchObject({
        pid: process.pid,
        scope: sessionFile,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
