import { existsSync, mkdtempSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  hasAcceptedSessionAction,
  recordAcceptedSessionAction,
} from "../../../src/pi/session-action-dedupe.js";
import { acquireWriterLock, migrateWriterLockScope } from "../../../src/pi/session-writer-lock.js";

describe("session action dedupe store", () => {
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
      recordAcceptedSessionAction(fallbackManager, "action-1");

      expect(migrateWriterLockScope(dir, sessionFile)).toBe(true);

      expect(hasAcceptedSessionAction(fileManager, "action-1")).toBe(true);
      expect(hasAcceptedSessionAction(fallbackManager, "action-1")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
