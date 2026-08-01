import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingSessionAction,
  hasAcceptedSessionAction,
  hasPendingSessionAction,
  readSessionActionStoreSnapshot,
  recordAcceptedSessionAction,
  recordPendingSessionAction,
  restoreSessionActionStoreSnapshot,
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

  it("rejects reuse of an action id with a different input fingerprint", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-action-fingerprint-"));
    try {
      const sessionManager = {
        getSessionFile: () => join(dir, "session.jsonl"),
        getSessionDir: () => dir,
      };
      recordAcceptedSessionAction(sessionManager, "action-1", "input-a");

      expect(hasAcceptedSessionAction(sessionManager, "action-1", "input-a")).toBe(true);
      expect(() => hasAcceptedSessionAction(sessionManager, "action-1", "input-b")).toThrow(
        "different input",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats object prototype names as unused action ids", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-action-prototype-id-"));
    try {
      const sessionManager = {
        getSessionFile: () => join(dir, "session.jsonl"),
        getSessionDir: () => dir,
      };

      expect(() =>
        recordPendingSessionAction(sessionManager, "constructor", "input-a"),
      ).not.toThrow();
      expect(hasPendingSessionAction(sessionManager, "constructor", "input-a")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("prunes fingerprints with evicted accepted and expired pending actions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    const dir = mkdtempSync(join(tmpdir(), "opencandle-action-fingerprint-prune-"));
    try {
      const sessionFile = join(dir, "session.jsonl");
      const sessionManager = {
        getSessionFile: () => sessionFile,
        getSessionDir: () => dir,
      };

      for (let index = 0; index < 501; index += 1) {
        recordAcceptedSessionAction(sessionManager, `accepted-${index}`, `input-${index}`);
      }
      recordPendingSessionAction(sessionManager, "pending-expired", "old-input");

      vi.setSystemTime(new Date("2026-07-01T00:03:00.000Z"));
      recordPendingSessionAction(sessionManager, "pending-current", "current-input");

      const snapshot = readSessionActionStoreSnapshot(sessionManager);
      const parsed = JSON.parse(snapshot?.content ?? "") as {
        acceptedActionIds: string[];
        pendingActionIds: Array<{ id: string }>;
        actionFingerprints: Record<string, string>;
      };
      expect(parsed.acceptedActionIds).toHaveLength(500);
      expect(parsed.acceptedActionIds).not.toContain("accepted-0");
      expect(Object.keys(parsed.actionFingerprints)).toHaveLength(501);
      expect(parsed.actionFingerprints).not.toHaveProperty("accepted-0");
      expect(parsed.actionFingerprints).not.toHaveProperty("pending-expired");
      expect(parsed.actionFingerprints).toMatchObject({
        "accepted-500": "input-500",
        "pending-current": "current-input",
      });

      expect(() =>
        recordPendingSessionAction(sessionManager, "pending-expired", "new-input"),
      ).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("round-trips the canonical action sidecar through an opaque snapshot", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "opencandle-action-snapshot-source-"));
    const targetDir = mkdtempSync(join(tmpdir(), "opencandle-action-snapshot-target-"));
    try {
      const source = {
        getSessionFile: () => join(sourceDir, "session.jsonl"),
        getSessionDir: () => sourceDir,
      };
      const target = {
        getSessionFile: () => join(targetDir, "session.jsonl"),
        getSessionDir: () => targetDir,
      };
      recordAcceptedSessionAction(source, "action-1", "input-a");
      const snapshot = readSessionActionStoreSnapshot(source);

      expect(snapshot).toEqual(expect.objectContaining({ content: expect.any(String) }));
      restoreSessionActionStoreSnapshot(target, snapshot?.content ?? "");
      expect(hasAcceptedSessionAction(target, "action-1", "input-a")).toBe(true);
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(targetDir, { recursive: true, force: true });
    }
  });

  it("fails closed when the action sidecar is corrupt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-action-corrupt-"));
    try {
      const sessionFile = join(dir, "session.jsonl");
      const sessionManager = {
        getSessionFile: () => sessionFile,
        getSessionDir: () => dir,
      };
      writeFileSync(`${sessionFile}.accepted-actions.json`, "{truncated", "utf8");

      expect(() => readSessionActionStoreSnapshot(sessionManager)).toThrow();
      expect(() => hasAcceptedSessionAction(sessionManager, "action-1")).toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("migrates accepted action ids when the writer lock moves to the session file", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
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
      recordPendingSessionAction(fallbackManager, "pending-action", "pending-input", {
        durable: true,
      });
      recordAcceptedSessionAction(fallbackManager, "action-1", "accepted-input");

      expect(migrateWriterLockScope(dir, sessionFile)).toBe(true);

      vi.setSystemTime(new Date("2026-07-01T00:03:00.000Z"));
      expect(hasAcceptedSessionAction(fileManager, "action-1", "accepted-input")).toBe(true);
      expect(() => hasAcceptedSessionAction(fileManager, "action-1", "changed")).toThrow(
        "different input",
      );
      expect(hasPendingSessionAction(fileManager, "pending-action", "pending-input")).toBe(true);
      expect(() => hasPendingSessionAction(fileManager, "pending-action", "changed")).toThrow(
        "different input",
      );
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

  it("expires stale unresolved pending action ids without accepting them", async () => {
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
      expect(hasAcceptedSessionAction(sessionManager, "action-1")).toBe(false);

      recordPendingSessionAction(sessionManager, "action-1");
      expect(hasPendingSessionAction(sessionManager, "action-1")).toBe(true);
      expect(hasAcceptedSessionAction(sessionManager, "action-1")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("retains explicitly durable pending action ids for ambiguous paid-work recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    const dir = mkdtempSync(join(tmpdir(), "opencandle-action-dedupe-durable-pending-"));
    try {
      const sessionFile = join(dir, "session.jsonl");
      const sessionManager = {
        getSessionFile: () => sessionFile,
        getSessionDir: () => dir,
      };

      recordPendingSessionAction(sessionManager, "paid-action", "input-a", {
        durable: true,
      });
      vi.setSystemTime(new Date("2026-07-02T00:00:00.000Z"));

      expect(hasPendingSessionAction(sessionManager, "paid-action", "input-a")).toBe(true);
      expect(hasAcceptedSessionAction(sessionManager, "paid-action", "input-a")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps original pending timestamps across unrelated store writes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    const dir = mkdtempSync(join(tmpdir(), "opencandle-action-dedupe-restamp-"));
    try {
      const sessionFile = join(dir, "session.jsonl");
      const sessionManager = {
        getSessionFile: () => sessionFile,
        getSessionDir: () => dir,
      };

      recordPendingSessionAction(sessionManager, "action-1");

      vi.setSystemTime(new Date("2026-07-01T00:01:30.000Z"));
      recordPendingSessionAction(sessionManager, "action-2");
      recordAcceptedSessionAction(sessionManager, "action-2");

      vi.setSystemTime(new Date("2026-07-01T00:02:30.000Z"));
      expect(hasPendingSessionAction(sessionManager, "action-1")).toBe(false);
      expect(hasAcceptedSessionAction(sessionManager, "action-1")).toBe(false);
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
