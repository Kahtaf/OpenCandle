import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { listDisplaySessions } from "../../../gui/server/session-list.js";

describe("listDisplaySessions", () => {
  it("omits persisted sessions with no messages without deleting them", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-session-list-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-session-list-sessions-"));
    try {
      const emptyId = "empty-session";
      await writeFile(
        join(sessionDir, "empty-session.jsonl"),
        `${JSON.stringify({
          type: "session",
          version: 3,
          id: emptyId,
          timestamp: "2026-07-09T00:00:00.000Z",
          cwd,
        })}\n`,
      );
      const populated = SessionManager.create(cwd, sessionDir);
      populated.appendMessage({ role: "user", content: "Review my portfolio" });
      populated.appendMessage({ role: "assistant", content: "I can help with that." });

      // Tool-result-only sessions have messageCount > 0 but no user text; Pi
      // lists them with a "(no messages)" firstMessage and they must stay hidden.
      const toolOnly = SessionManager.create(cwd, sessionDir);
      toolOnly.appendMessage({
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "manage_watchlist",
        content: [{ type: "text", text: "added RKLB" }],
        isError: false,
      });

      const sessions = await listDisplaySessions(cwd, sessionDir);
      const ids = sessions.map((session) => session.id);

      expect(ids).toContain(populated.getSessionId());
      expect(ids).not.toContain(toolOnly.getSessionId());
      expect(ids).not.toContain(emptyId);
      expect((await SessionManager.list(cwd, sessionDir)).map((session) => session.id)).toContain(
        emptyId,
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});
