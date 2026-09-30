import { mkdtempSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  createDetachedSessionRegistry,
  createInitialGuiSessionManager,
} from "../../../gui/server/gui-session-manager.js";

describe("createInitialGuiSessionManager", () => {
  it("starts the GUI on a fresh chat instead of continuing the most recent session", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-gui-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-gui-sessions-"));
    try {
      const previous = SessionManager.create(cwd, sessionDir);
      previous.appendMessage({ role: "user", content: "previous session" });

      const initial = createInitialGuiSessionManager(cwd, sessionDir);

      expect(initial.getSessionId()).not.toBe(previous.getSessionId());
      expect(initial.getEntries()).toEqual([]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});

describe("createDetachedSessionRegistry", () => {
  it("creates a resolvable fresh session without touching the current one or the disk", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-gui-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-gui-sessions-"));
    try {
      const registry = createDetachedSessionRegistry();
      const detached = registry.create(cwd, sessionDir);

      expect(detached.getSessionId()).toBeTruthy();
      expect(detached.getEntries()).toEqual([]);
      expect(registry.get(detached.getSessionId())).toBe(detached);
      expect(registry.get("unknown-session")).toBeUndefined();
      expect(readdirSync(sessionDir)).toEqual([]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("hands resolution back to the saved session list once the session is persisted", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-gui-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-gui-sessions-"));
    try {
      const registry = createDetachedSessionRegistry();
      const detached = registry.create(cwd, sessionDir);
      detached.appendMessage({ role: "user", content: "first prompt" });
      detached.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "first answer" }],
        api: "openai-completions",
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
        stopReason: "stop",
        timestamp: Date.now(),
      });

      expect(registry.get(detached.getSessionId())).toBeUndefined();
      const saved = await SessionManager.list(cwd, sessionDir);
      expect(saved.map((session) => session.id)).toContain(detached.getSessionId());
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("keeps a bounded number of unsent sessions", () => {
    const registry = createDetachedSessionRegistry({ limit: 2 });
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-gui-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-gui-sessions-"));
    const first = registry.create(cwd, sessionDir);
    const second = registry.create(cwd, sessionDir);
    const third = registry.create(cwd, sessionDir);

    expect(registry.get(first.getSessionId())).toBeUndefined();
    expect(registry.get(second.getSessionId())).toBe(second);
    expect(registry.get(third.getSessionId())).toBe(third);
  });
});
