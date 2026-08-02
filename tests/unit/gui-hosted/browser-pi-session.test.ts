import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertTerminalAssistantSucceeded,
  BrowserPiSession,
} from "../../../gui/hosted/runtime/browser-pi-session.js";
import { createSqlJsStateDatabase } from "../../../src/runtime/sqljs-state-database-node.js";

describe("BrowserPiSession model history", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("records a Pi model change when an existing hosted session switches providers", async () => {
    const root = mkdtempSync(join(tmpdir(), "opencandle-browser-pi-"));
    roots.push(root);
    const sessionDir = join(root, "sessions");
    const stateFile = join(root, "state.sqlite3");
    const database = await createSqlJsStateDatabase();

    const previous = SessionManager.create(root, sessionDir);
    previous.appendModelChange("openai", "gpt-5-mini");
    previous.appendMessage({ role: "user", content: "Previous hosted turn" });
    previous.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Previous hosted answer" }],
      api: "responses",
      provider: "openai",
      model: "gpt-5-mini",
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
    const restoredFile = join(sessionDir, findSessionFile(sessionDir));

    const anthropic = await BrowserPiSession.create({
      cwd: root,
      sessionDir,
      restoredSessionFile: restoredFile,
      stateFile,
      stateDatabase: database,
      providerId: "anthropic",
      modelId: "claude-haiku-4-5",
      credentials: { anthropic: "anthropic-key" },
      toolDefinitions: [],
    });
    expect((anthropic as any).session).toEqual(
      expect.objectContaining({
        compact: expect.any(Function),
        setModel: expect.any(Function),
        setThinkingLevel: expect.any(Function),
      }),
    );
    anthropic.dispose();
    database.close();

    const entries = readFileSync(restoredFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(entries.filter((entry) => entry.type === "model_change")).toEqual([
      expect.objectContaining({ provider: "openai", modelId: "gpt-5-mini" }),
      expect.objectContaining({ provider: "anthropic", modelId: "claude-haiku-4-5" }),
    ]);
  });

  it("preserves thinking selected before the first message across session restarts", async () => {
    const root = mkdtempSync(join(tmpdir(), "opencandle-browser-pi-thinking-"));
    roots.push(root);
    const sessionDir = join(root, "sessions");
    const stateFile = join(root, "state.sqlite3");
    const database = await createSqlJsStateDatabase();
    const manager = SessionManager.create(root, sessionDir);
    const sessionFile = manager.getSessionFile();
    const header = manager.getHeader();
    if (!sessionFile || !header) throw new Error("Expected a Pi session header");
    writeFileSync(sessionFile, `${JSON.stringify(header)}\n`, { flag: "wx" });
    manager.appendModelChange("openai", "gpt-5-mini");
    manager.appendThinkingLevelChange("minimal");
    const restoredFile = sessionFile;

    for (let restart = 0; restart < 2; restart += 1) {
      const session = await BrowserPiSession.create({
        cwd: root,
        sessionDir,
        restoredSessionFile: restoredFile,
        stateFile,
        stateDatabase: database,
        providerId: "openai",
        modelId: "gpt-5-mini",
        credentials: { openai: "openai-key" },
        toolDefinitions: [],
      });
      expect(session.getThinkingState().current).toBe("minimal");
      session.dispose();
    }

    const entries = readFileSync(restoredFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const thinkingEntries = entries.filter((entry) => entry.type === "thinking_level_change");
    expect(thinkingEntries.length).toBeGreaterThan(0);
    expect(thinkingEntries).not.toContainEqual(expect.objectContaining({ thinkingLevel: "off" }));
    expect(thinkingEntries.at(-1)).toMatchObject({ thinkingLevel: "minimal" });
    database.close();
  });
});

describe("BrowserPiSession terminal outcomes", () => {
  it("persists slash-command input for hosted workflow reloads without attachments", () => {
    const appendCustomEntry = vi.fn();
    const session = { sessionManager: { appendCustomEntry } };

    BrowserPiSession.prototype.markOriginalInput.call(session, "/analyze NVDA", []);

    expect(appendCustomEntry).toHaveBeenCalledWith("opencandle-user-input", {
      original: "/analyze NVDA",
      attachments: [],
    });
  });

  it("does not leave an original-input marker for slash commands without workflow turns", () => {
    const appendCustomEntry = vi.fn();
    const session = { sessionManager: { appendCustomEntry } };

    BrowserPiSession.prototype.markOriginalInput.call(session, "/setup", []);
    BrowserPiSession.prototype.markOriginalInput.call(session, "/connect openai", []);
    BrowserPiSession.prototype.markOriginalInput.call(session, "/analyze", []);

    expect(appendCustomEntry).not.toHaveBeenCalled();
  });

  it("delegates thinking levels to the real Pi session contract", () => {
    const setThinkingLevel = vi.fn(function (this: { thinkingLevel: string }, level: string) {
      this.thinkingLevel = level;
    });
    const browserSession = {
      session: {
        thinkingLevel: "low",
        getAvailableThinkingLevels: () => ["off", "low", "high"],
        setThinkingLevel,
      },
      getThinkingState: BrowserPiSession.prototype.getThinkingState,
    };

    expect(BrowserPiSession.prototype.getThinkingState.call(browserSession)).toEqual({
      current: "low",
      available: ["off", "low", "high"],
    });
    expect(BrowserPiSession.prototype.setThinkingLevel.call(browserSession, "high")).toEqual({
      current: "high",
      available: ["off", "low", "high"],
    });
    expect(setThinkingLevel).toHaveBeenCalledWith("high");
  });

  it("surfaces the provider message when Pi ends the turn with an error", () => {
    expect(() =>
      assertTerminalAssistantSucceeded([
        {
          role: "assistant",
          stopReason: "error",
          errorMessage: "OpenAI rejected this request",
        },
      ]),
    ).toThrow("OpenAI rejected this request");
  });

  it("turns a Pi-aborted assistant outcome into an AbortError", () => {
    expect.assertions(2);
    try {
      assertTerminalAssistantSucceeded([
        {
          role: "assistant",
          stopReason: "aborted",
          errorMessage: "Provider stream was cancelled",
        },
      ]);
    } catch (error) {
      expect(error).toBeInstanceOf(DOMException);
      expect(error).toMatchObject({ name: "AbortError", message: "Provider stream was cancelled" });
    }
  });

  it("checkpoints market state when the terminal assistant result fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "opencandle-browser-pi-failure-"));
    const stateFile = join(root, "state.sqlite3");
    const stateBytes = Uint8Array.from([1, 2, 3, 4]);
    const session = {
      session: {
        state: {
          messages: [
            {
              role: "assistant",
              stopReason: "error",
              errorMessage: "provider failed after mutation",
            },
          ],
        },
        prompt: async () => undefined,
        waitForIdle: async () => undefined,
        abort: async () => undefined,
      },
      sessionManager: { getEntries: () => [] },
      waitForSettled: async () => undefined,
      stateDatabase: { exportBytes: () => stateBytes },
      stateFile,
    };

    try {
      await expect(BrowserPiSession.prototype.prompt.call(session, "question")).rejects.toThrow(
        "provider failed after mutation",
      );
      expect(readFileSync(stateFile)).toEqual(Buffer.from(stateBytes));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function findSessionFile(sessionDir: string): string {
  const filename = readdirSync(sessionDir).find((name) => name.endsWith(".jsonl"));
  if (!filename) throw new Error("Expected a Pi session file");
  return filename;
}
