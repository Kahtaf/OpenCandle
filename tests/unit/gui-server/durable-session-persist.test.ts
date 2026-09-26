import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { persistUnflushedSession } from "../../../gui/server/durable-session-persist.js";

const tempDirs: string[] = [];

function makeSessionManager(): { sessionDir: string; manager: SessionManager } {
  const cwd = mkdtempSync(join(tmpdir(), "oc-durable-cwd-"));
  const sessionDir = mkdtempSync(join(tmpdir(), "oc-durable-sessions-"));
  tempDirs.push(cwd, sessionDir);
  return { sessionDir, manager: SessionManager.create(cwd, sessionDir) };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("durable cancelled-session persistence", () => {
  it("writes an unflushed cancelled session so a reopen sees the marker", () => {
    const { manager } = makeSessionManager();
    manager.appendCustomEntry("opencandle-run-cancelled", { text: "hold then stop" });
    const file = manager.getSessionFile()!;
    expect(existsSync(file)).toBe(false);

    expect(persistUnflushedSession(manager)).toBe(true);

    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const reopened = SessionManager.open(file);
    expect(reopened.getHeader()?.id).toBe(manager.getSessionId());
    expect(reopened.getEntries()).toHaveLength(1);
    expect(reopened.getEntries()[0]).toMatchObject({
      type: "custom",
      customType: "opencandle-run-cancelled",
      data: { text: "hold then stop" },
    });
  });

  it("lets a later append reach disk and reopen without a duplicate header", () => {
    const { manager } = makeSessionManager();
    manager.appendCustomEntry("opencandle-run-cancelled", { text: "hold then stop" });
    expect(persistUnflushedSession(manager)).toBe(true);

    manager.appendCustomEntry("opencandle-user-input", { original: "analyze NVDA" });
    const reopened = SessionManager.open(manager.getSessionFile()!);
    const entries = reopened.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      type: "custom",
      customType: "opencandle-user-input",
      data: { original: "analyze NVDA" },
    });
    const headerLines = readFileSync(manager.getSessionFile()!, "utf8")
      .split("\n")
      .filter((line) => line.includes('"type":"session"'));
    expect(headerLines).toHaveLength(1);
  });

  it("accepts a later genuine user and assistant turn without reload corruption", () => {
    const { manager } = makeSessionManager();
    manager.appendCustomEntry("opencandle-run-cancelled", { text: "hold then stop" });
    expect(persistUnflushedSession(manager)).toBe(true);

    manager.appendMessage({ role: "user", content: "retry please", timestamp: Date.now() });
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "here you go" }],
      api: "openai-responses",
      provider: "openai",
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

    const reopened = SessionManager.open(manager.getSessionFile()!);
    expect(reopened.getEntries()).toHaveLength(3);
    const headerLines = readFileSync(manager.getSessionFile()!, "utf8")
      .split("\n")
      .filter((line) => line.includes('"type":"session"'));
    expect(headerLines).toHaveLength(1);
  });

  it("never overwrites an existing session file", () => {
    const { manager } = makeSessionManager();
    manager.appendCustomEntry("opencandle-run-cancelled", { text: "first" });
    const file = manager.getSessionFile()!;
    writeFileSync(file, "preexisting-content\n", { mode: 0o600 });

    expect(persistUnflushedSession(manager)).toBe(false);
    expect(readFileSync(file, "utf8")).toBe("preexisting-content\n");
  });

  it("returns false for a session that does not persist to disk", () => {
    const manager = SessionManager.inMemory("/tmp");
    manager.appendCustomEntry("opencandle-run-cancelled", { text: "hold then stop" });
    expect(persistUnflushedSession(manager)).toBe(false);
  });

  it("throws when the session file cannot be written", () => {
    const { sessionDir, manager } = makeSessionManager();
    manager.appendCustomEntry("opencandle-run-cancelled", { text: "hold then stop" });
    rmSync(sessionDir, { recursive: true, force: true });

    expect(() => persistUnflushedSession(manager)).toThrow();
    expect(existsSync(manager.getSessionFile()!)).toBe(false);
  });
});
