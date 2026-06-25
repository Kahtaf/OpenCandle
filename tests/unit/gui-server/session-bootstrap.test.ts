import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { buildSessionBootstrapPayload } from "../../../gui/server/http-routes.js";

describe("session-addressed GUI bootstrap", () => {
  it("builds a transcript snapshot for the requested session without using active state", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-session-bootstrap-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-session-bootstrap-sessions-"));
    try {
      const requested = SessionManager.create(cwd, sessionDir);
      requested.appendSessionInfo("Requested session");
      requested.appendMessage({ role: "user", content: "Load this exact session" });

      const other = SessionManager.create(cwd, sessionDir);
      other.appendMessage({ role: "user", content: "Do not load me" });

      const payload = await buildSessionBootstrapPayload(
        {
          cwd,
          sessionDir,
          role: "writer",
          modelSetupController: {
            buildCurrentModelSetupState: () => ({
              requirement: "ready",
              providers: [],
              availableModels: [],
            }),
          },
        },
        requested,
      );

      expect(payload.sessionId).toBe(requested.getSessionId());
      const snapshot = payload.snapshot as {
        sessionId: string;
        events: Array<{ sessionId: string; type: string }>;
      };
      expect(snapshot.sessionId).toBe(requested.getSessionId());
      expect(snapshot.events.every((event) => event.sessionId === requested.getSessionId())).toBe(
        true,
      );
      expect(JSON.stringify(snapshot.events)).toContain("Load this exact session");
      expect(JSON.stringify(snapshot.events)).not.toContain("Do not load me");
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});
