import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createInitialGuiSessionManager } from "../../../gui/server/gui-session-manager.js";

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
