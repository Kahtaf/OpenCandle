import { describe, expect, it, vi } from "vitest";
import {
  BrowserHostedGuiRuntime,
  selectSessionCheckpoints,
} from "../../../gui/hosted/runtime/browser-hosted-gui-runtime.js";
import { createSqlJsStateDatabase } from "../../../src/runtime/sqljs-state-database-node.js";

describe("BrowserHostedGuiRuntime action safety", () => {
  it("rejects a second paid run for the same session while one is active", async () => {
    let finishPrompt!: () => void;
    const prompt = vi.fn(
      () =>
        new Promise<{ sessionId: string }>((resolve) => {
          finishPrompt = () => resolve({ sessionId: "session-1" });
        }),
    );
    const runtime = createRuntime({
      createPiSession: vi.fn(async () => ({ prompt, dispose: vi.fn() })),
    });

    const first = runtime.chatRun("session-1", "First", "run-1");
    await Promise.resolve();

    await expect(runtime.chatRun("session-1", "Second", "run-2")).rejects.toThrow("already active");
    expect(prompt).toHaveBeenCalledTimes(1);

    finishPrompt();
    await first;
  });

  it("does not pay for a completed logical run twice when its acknowledgement is retried", async () => {
    const prompt = vi.fn(async () => ({ sessionId: "session-1" }));
    const runtime = createRuntime({
      createPiSession: vi.fn(async () => ({ prompt, dispose: vi.fn() })),
    });

    const first = await runtime.chatRun("session-1", "First", "run-1");
    const retry = await runtime.chatRun("session-1", "First", "run-1");

    expect(retry).toBe(first);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("deduplicates a retried logical market-state action", async () => {
    const database = await createSqlJsStateDatabase();
    const runtime = createRuntime({}, database);

    const first = await runtime.invokeTool("session-1", "action-1", "manage_watchlist", {
      action: "add",
      symbol: "AAPL",
    });
    const retry = await runtime.invokeTool("session-1", "action-1", "manage_watchlist", {
      action: "add",
      symbol: "MSFT",
    });

    expect(retry).toBe(first);
    expect(runtime.marketState().watchlist).toHaveLength(1);
    expect(runtime.marketState().watchlist[0]).toMatchObject({ symbol: "AAPL" });
    database.close();
  });

  it("always checkpoints the current session within the bounded archive", () => {
    const sessions = Array.from({ length: 101 }, (_, index) => ({
      sessionId: `session-${index}`,
      filename: `${String(index).padStart(3, "0")}.jsonl`,
      content: "{}",
    }));

    const selected = selectSessionCheckpoints(sessions, "session-100");

    expect(selected).toHaveLength(100);
    expect(selected[0]?.sessionId).toBe("session-100");
  });
});

function createRuntime(
  overrides: Record<string, unknown> = {},
  database: any = { exportBytes: vi.fn(() => new Uint8Array()), close: vi.fn() },
) {
  const runtime = new (BrowserHostedGuiRuntime as any)(
    {
      cwd: "/workspace",
      sessionDir: "/sessions",
      stateFile: "/state/current.sqlite3",
      modelId: "gpt-4.1-mini",
      apiKey: "test-key",
      ...overrides,
    },
    database,
  );
  runtime.resolveManager = vi.fn(async () => ({
    getSessionFile: () => "/sessions/session-1.jsonl",
  }));
  runtime.buildBootstrap = vi.fn(async () => ({
    role: "writer",
    sessionId: "session-1",
    supportsSessionActions: true,
    coordination: { sessionId: "session-1", ownerKind: "hosted", writable: true },
    sessions: [],
    catalog: { tools: [], workflows: [], providers: [] },
    askUserPrompts: [],
    snapshot: { sessionId: "session-1", entries: [], events: [], state: {} },
    checkpoint: {
      sessions: [],
      state: { format: "sqlite3", filename: "current.sqlite3", contentBase64: "" },
    },
  }));
  runtime.flushState = vi.fn();
  return runtime;
}
