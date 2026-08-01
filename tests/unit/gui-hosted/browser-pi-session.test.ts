import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
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
});

describe("BrowserPiSession terminal outcomes", () => {
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
});

function findSessionFile(sessionDir: string): string {
  const filename = readdirSync(sessionDir).find((name) => name.endsWith(".jsonl"));
  if (!filename) throw new Error("Expected a Pi session file");
  return filename;
}
