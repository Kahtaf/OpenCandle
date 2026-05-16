import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { deleteSessionFile, renameSessionFile } from "../../../gui/server/session-actions.js";

describe("GUI session actions", () => {
  it("renames a Pi session by appending session_info so the TUI session list sees it", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-session-actions-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-session-actions-sessions-"));
    try {
      const manager = SessionManager.create(cwd, sessionDir);
      manager.appendMessage({ role: "user", content: "Original title source" });
      manager.appendMessage(assistantMessage("Original response"));
      const sessionFile = manager.getSessionFile();
      expect(sessionFile).toBeTruthy();

      await renameSessionFile(cwd, sessionDir, sessionFile!, "Macro watchlist");

      const listed = await SessionManager.list(cwd, sessionDir);
      expect(listed.find((session) => session.path === sessionFile)?.name).toBe("Macro watchlist");
      expect(SessionManager.open(sessionFile!).getSessionName()).toBe("Macro watchlist");
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("deletes a Pi session file so it is no longer resumable", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-session-actions-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-session-actions-sessions-"));
    try {
      const manager = SessionManager.create(cwd, sessionDir);
      manager.appendMessage({ role: "user", content: "Delete me" });
      manager.appendMessage(assistantMessage("Deleted response"));
      const sessionFile = manager.getSessionFile();
      expect(sessionFile).toBeTruthy();

      await deleteSessionFile(cwd, sessionDir, sessionFile!);

      expect(existsSync(sessionFile!)).toBe(false);
      const listed = await SessionManager.list(cwd, sessionDir);
      expect(listed.some((session) => session.path === sessionFile)).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});

function assistantMessage(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}
