import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { sessionEntriesToChatEvents } from "../../../gui/server/chat-event-adapter.js";
import { continueOpenCandleSession } from "../../../src/pi/session-storage.js";

describe("GUI and TUI session resume", () => {
  it("lists TUI-created sessions and replays them as GUI chat events", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-gui-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-gui-sessions-"));
    try {
      const tui = SessionManager.create(cwd, sessionDir);
      tui.appendMessage({ role: "user", content: "TUI quote request" });
      tui.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "TUI response" }],
        api: "openai-responses",
        provider: "test",
        model: "test",
        usage: emptyUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      });

      const listed = await SessionManager.list(cwd, sessionDir);
      expect(listed.map((session) => session.id)).toContain(tui.getSessionId());

      const gui = SessionManager.continueRecent(cwd, sessionDir);
      expect(gui.getSessionId()).toBe(tui.getSessionId());

      const events = sessionEntriesToChatEvents(gui.getEntries(), {
        sessionId: gui.getSessionId(),
      });
      expect(
        events.some((event) => event.type === "message.created" && event.role === "user"),
      ).toBe(true);
      expect(
        events.some((event) => event.type === "message.created" && event.role === "assistant"),
      ).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("keeps GUI-created sessions resumable by the shared session layer", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-gui-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-gui-sessions-"));
    try {
      const gui = SessionManager.create(cwd, sessionDir);
      gui.appendMessage({ role: "user", content: "GUI prompt" });
      gui.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "GUI response" }],
        api: "openai-responses",
        provider: "test",
        model: "test",
        usage: emptyUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      });
      const sessionPath = gui.getSessionFile();
      expect(sessionPath).toBeTruthy();

      const tui = SessionManager.continueRecent(cwd, sessionDir);
      expect(tui.getSessionId()).toBe(gui.getSessionId());
      expect(tui.getSessionFile()).toBe(sessionPath);
      expect(tui.getEntries().some((entry) => entry.type === "message")).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("stores TUI sessions under the project cwd that the GUI lists", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-gui-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-gui-sessions-"));
    try {
      const tui = continueOpenCandleSession(cwd, sessionDir);
      tui.appendMessage({ role: "user", content: "TUI DRAM prompt" });
      tui.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "TUI DRAM response" }],
        api: "openai-responses",
        provider: "test",
        model: "test",
        usage: emptyUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      });

      const listed = await SessionManager.list(cwd, sessionDir);
      expect(listed.map((session) => session.id)).toContain(tui.getSessionId());
      expect(tui.getCwd()).toBe(cwd);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
