import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingSessionAction,
  hasAcceptedSessionAction,
  hasPendingSessionAction,
  recordAcceptedSessionAction,
  recordPendingSessionAction,
} from "../../../src/pi/session-action-dedupe.js";
import { acquireWriterLock, migrateWriterLockScope } from "../../../src/pi/session-writer-lock.js";

describe("session action dedupe store", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists accepted action ids beside a session file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-action-dedupe-"));
    try {
      const sessionFile = join(dir, "session.jsonl");
      const sessionManager = {
        getSessionFile: () => sessionFile,
        getSessionDir: () => dir,
      };

      recordAcceptedSessionAction(sessionManager, "action-1");

      expect(hasAcceptedSessionAction(sessionManager, "action-1")).toBe(true);
      expect(hasPendingSessionAction(sessionManager, "action-1")).toBe(false);
      expect(hasAcceptedSessionAction(sessionManager, "action-2")).toBe(false);
      const storePath = `${sessionFile}.accepted-actions.json`;
      expect(existsSync(storePath)).toBe(true);
      expect(statSync(storePath).mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("migrates accepted action ids when the writer lock moves to the session file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-action-dedupe-migrate-"));
    try {
      const sessionFile = join(dir, "session.jsonl");
      const fallbackManager = {
        getSessionFile: () => undefined,
        getSessionDir: () => dir,
      };
      const fileManager = {
        getSessionFile: () => sessionFile,
        getSessionDir: () => dir,
      };
      await acquireWriterLock(dir, "gui");
      recordPendingSessionAction(fallbackManager, "pending-action");
      recordAcceptedSessionAction(fallbackManager, "action-1");

      expect(migrateWriterLockScope(dir, sessionFile)).toBe(true);

      expect(hasAcceptedSessionAction(fileManager, "action-1")).toBe(true);
      expect(hasPendingSessionAction(fileManager, "pending-action")).toBe(true);
      expect(hasAcceptedSessionAction(fallbackManager, "action-1")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("clears pending action ids after handled failures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-action-dedupe-clear-"));
    try {
      const sessionFile = join(dir, "session.jsonl");
      const sessionManager = {
        getSessionFile: () => sessionFile,
        getSessionDir: () => dir,
      };

      recordPendingSessionAction(sessionManager, "action-1");

      expect(hasPendingSessionAction(sessionManager, "action-1")).toBe(true);

      clearPendingSessionAction(sessionManager, "action-1");

      expect(hasPendingSessionAction(sessionManager, "action-1")).toBe(false);
      expect(hasAcceptedSessionAction(sessionManager, "action-1")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("expires stale pending action ids so retries recover after a crashed owner", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    const dir = mkdtempSync(join(tmpdir(), "opencandle-action-dedupe-stale-"));
    try {
      const sessionFile = join(dir, "session.jsonl");
      const sessionManager = {
        getSessionFile: () => sessionFile,
        getSessionDir: () => dir,
      };

      recordPendingSessionAction(sessionManager, "action-1");
      expect(hasPendingSessionAction(sessionManager, "action-1")).toBe(true);

      vi.setSystemTime(new Date("2026-07-01T00:03:00.000Z"));
      expect(hasPendingSessionAction(sessionManager, "action-1")).toBe(false);

      recordPendingSessionAction(sessionManager, "action-1");
      expect(hasPendingSessionAction(sessionManager, "action-1")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores legacy string pending ids without blocking retries forever", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-action-dedupe-legacy-"));
    try {
      const sessionFile = join(dir, "session.jsonl");
      const sessionManager = {
        getSessionFile: () => sessionFile,
        getSessionDir: () => dir,
      };
      const storePath = `${sessionFile}.accepted-actions.json`;
      writeFileSync(
        storePath,
        JSON.stringify({ acceptedActionIds: [], pendingActionIds: ["action-1"] }),
      );

      expect(hasPendingSessionAction(sessionManager, "action-1")).toBe(false);

      recordPendingSessionAction(sessionManager, "action-1");
      const parsed = JSON.parse(readFileSync(storePath, "utf8")) as {
        pendingActionIds?: Array<{ id?: unknown; pendingAtMs?: unknown }>;
      };
      expect(parsed.pendingActionIds).toEqual([
        expect.objectContaining({ id: "action-1", pendingAtMs: expect.any(Number) }),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
