import { describe, expect, it, vi } from "vitest";
import {
  assertHostedBootstrapPersistable,
  BrowserHostedGuiRuntime,
  MAX_COMPLETED_CHAT_RESULTS,
  selectSessionCheckpoints,
} from "../../../gui/hosted/runtime/browser-hosted-gui-runtime.js";
import { SessionManager } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js";
import { createSqlJsStateDatabase } from "../../../src/runtime/sqljs-state-database-node.js";

describe("BrowserHostedGuiRuntime action safety", () => {
  it("rejects deleting a session while its chat run is active", async () => {
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

    const run = runtime.chatRun("session-1", chatInput("First"), "run-1");
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());

    await expect(runtime.deleteSession("session-1")).rejects.toThrow("active");

    finishPrompt();
    await run;
  });

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

    const first = runtime.chatRun("session-1", chatInput("First"), "run-1");
    await Promise.resolve();

    await expect(runtime.chatRun("session-1", chatInput("Second"), "run-2")).rejects.toThrow(
      "already active",
    );
    expect(prompt).toHaveBeenCalledTimes(1);

    finishPrompt();
    await first;
  });

  it("rejects a paid turn before invoking Pi when the projected archive cannot be persisted", async () => {
    const prompt = vi.fn(async () => ({ sessionId: "session-1" }));
    const runtime = createRuntime({
      maxArchiveBytes: 1,
      createPiSession: vi.fn(async () => ({ prompt, dispose: vi.fn() })),
    });

    await expect(
      runtime.chatRun("session-1", chatInput("This cannot fit"), "run-over-budget"),
    ).rejects.toThrow("browser storage limit");

    expect(prompt).not.toHaveBeenCalled();
  });

  it("rejects a new session before creating its durable file when the archive is full", async () => {
    const list = vi.spyOn(SessionManager, "list").mockResolvedValue([]);
    const create = vi.spyOn(SessionManager, "create").mockImplementation(() => {
      throw new Error("session was created");
    });
    const runtime = createRuntime({ maxArchiveBytes: 1 });
    runtime.bootstrap = vi.fn(async () => (runtime as any).buildBootstrap());

    try {
      await expect(runtime.newSession()).rejects.toThrow("browser storage limit");
      expect(create).not.toHaveBeenCalled();
    } finally {
      list.mockRestore();
      create.mockRestore();
    }
  });

  it("does not pay for a completed logical run twice when its acknowledgement is retried", async () => {
    const prompt = vi.fn(async () => ({ sessionId: "session-1" }));
    const runtime = createRuntime({
      createPiSession: vi.fn(async () => ({ prompt, dispose: vi.fn() })),
    });

    const first = await runtime.chatRun("session-1", chatInput("First"), "run-1");
    const retry = await runtime.chatRun("session-1", chatInput("First"), "run-1");

    expect(retry).toEqual({ ...first, events: [] });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("keeps only a lightweight idempotency marker for completed chat runs", async () => {
    const prompt = vi.fn(async () => ({ sessionId: "session-1" }));
    const runtime = createRuntime({
      createPiSession: vi.fn(async () => ({ prompt, dispose: vi.fn() })),
    });

    await runtime.chatRun("session-1", chatInput("First"), "run-1");

    expect((runtime as any).completedChatResults.get("session-1:run-1")).toEqual({
      fingerprint: expect.any(String),
      sessionId: "session-1",
    });
  });

  it("joins identical retries while their logical run is still in flight", async () => {
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

    const first = runtime.chatRun("session-1", chatInput("First"), "run-1");
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    const retry = runtime.chatRun("session-1", chatInput("First"), "run-1");

    finishPrompt();
    const [firstResult, retryResult] = await Promise.all([first, retry]);
    expect(retryResult).toBe(firstResult);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("does not switch back when a background run completes after another session was selected", async () => {
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
    (runtime as any).currentSessionId = "session-1";

    const run = runtime.chatRun("session-1", chatInput("First"), "run-background");
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    (runtime as any).currentSessionId = "session-2";
    finishPrompt();
    await run;

    expect((runtime as any).currentSessionId).toBe("session-2");
    expect((runtime as any).buildBootstrap).toHaveBeenLastCalledWith(expect.anything(), false);
  });

  it("rejects reuse of an in-flight action id for different input", async () => {
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

    const first = runtime.chatRun("session-1", chatInput("First"), "run-1");
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    await expect(runtime.chatRun("session-1", chatInput("Changed"), "run-1")).rejects.toThrow(
      "different input",
    );
    finishPrompt();
    await first;
  });

  it("bounds completed chat results", async () => {
    const prompt = vi.fn(async () => ({ sessionId: "session-1" }));
    const runtime = createRuntime({
      createPiSession: vi.fn(async () => ({ prompt, dispose: vi.fn() })),
    });

    for (let index = 0; index <= MAX_COMPLETED_CHAT_RESULTS; index += 1) {
      await runtime.chatRun("session-1", chatInput(`Run ${index}`), `run-${index}`);
    }

    expect((runtime as any).completedChatResults.size).toBe(MAX_COMPLETED_CHAT_RESULTS);
    expect((runtime as any).completedChatResults.has("session-1:run-0")).toBe(false);
  });

  it("deduplicates a retried logical market-state action", async () => {
    const database = await createSqlJsStateDatabase();
    const runtime = createRuntime({}, database);

    const first = await runtime.invokeTool("session-1", "action-1", "manage_watchlist", {
      action: "add",
      symbol: "AAPL",
    });
    const retry = await runtime.invokeTool("session-1", "action-1", "manage_watchlist", {
      symbol: "AAPL",
      action: "add",
    });

    expect(retry).toBe(first);
    expect(runtime.marketState().watchlist).toHaveLength(1);
    expect(runtime.marketState().watchlist[0]).toMatchObject({ symbol: "AAPL" });
    database.close();
  });

  it("rejects in-flight action id reuse with changed tool arguments", async () => {
    const database = await createSqlJsStateDatabase();
    const runtime = createRuntime({}, database);

    const first = runtime.invokeTool("session-1", "action-1", "manage_watchlist", {
      action: "add",
      symbol: "AAPL",
    });

    await expect(
      runtime.invokeTool("session-1", "action-1", "manage_watchlist", {
        action: "add",
        symbol: "MSFT",
      }),
    ).rejects.toThrow("different input");
    await first;
    expect(runtime.marketState().watchlist).toHaveLength(1);
    database.close();
  });

  it("rejects completed action id reuse with a different tool", async () => {
    const database = await createSqlJsStateDatabase();
    const runtime = createRuntime({}, database);

    await runtime.invokeTool("session-1", "action-1", "manage_watchlist", {
      action: "add",
      symbol: "AAPL",
    });

    await expect(
      runtime.invokeTool("session-1", "action-1", "track_portfolio", { action: "view" }),
    ).rejects.toThrow("different input");
    database.close();
  });

  it("never evicts an in-flight tool action from the idempotency map", async () => {
    const database = await createSqlJsStateDatabase();
    const runtime = createRuntime({}, database);
    const pending = new Promise<Record<string, unknown>>(() => {});
    (runtime as any).actionResults.set("session-1:pending", {
      fingerprint: "pending",
      operation: pending,
      settled: false,
    });
    for (let index = 0; index < 256; index += 1) {
      (runtime as any).actionResults.set(`session-1:settled-${index}`, {
        fingerprint: String(index),
        operation: Promise.resolve({ result: index }),
        settled: true,
      });
    }

    await runtime.invokeTool("session-1", "action-new", "manage_watchlist", {
      action: "add",
      symbol: "AAPL",
    });

    expect((runtime as any).actionResults.get("session-1:pending")?.operation).toBe(pending);
    expect((runtime as any).actionResults.size).toBeLessThanOrEqual(257);
    database.close();
  });

  it("gives Pi chat the same stateful tool contracts exposed by the hosted GUI", async () => {
    const createPiSession = vi.fn(async () => ({
      prompt: vi.fn(async () => ({ sessionId: "session-1" })),
      dispose: vi.fn(),
    }));
    const runtime = createRuntime({ createPiSession });

    await runtime.chatRun("session-1", chatInput("Add AAPL to my watchlist"), "run-state-tools");

    const toolNames = createPiSession.mock.calls[0]?.[0].toolDefinitions.map(
      (tool: { name: string }) => tool.name,
    );
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "manage_watchlist",
        "track_portfolio",
        "manage_alerts",
        "daily_watchlist_report",
        "manage_notifications",
      ]),
    );
  });

  it("forwards validated images into the Pi agent prompt", async () => {
    const prompt = vi.fn(async () => ({ sessionId: "session-1" }));
    const runtime = createRuntime({
      createPiSession: vi.fn(async () => ({ prompt, dispose: vi.fn() })),
    });
    const image = { data: Buffer.from("png").toString("base64"), mimeType: "image/png" };

    await runtime.chatRun(
      "session-1",
      { prompt: "Review this", images: [image], attachments: [] },
      "run-image",
    );

    expect(prompt).toHaveBeenCalledWith("Review this", undefined, [{ type: "image", ...image }]);
  });

  it("round-trips ask_user through the same GUI prompt contract", async () => {
    let sessionOptions: any;
    const createPiSession = vi.fn(async (options) => {
      sessionOptions = options;
      return {
        prompt: vi.fn(async () => {
          const result = await options.askUserHandler({
            question: "Which ticker?",
            questionType: "text",
            reason: "A ticker is required",
          });
          expect(result).toEqual({ answer: "AAPL", cancelled: false });
          return { sessionId: "session-1" };
        }),
        dispose: vi.fn(),
      };
    });
    const runtime = createRuntime({ createPiSession });
    const streamed: Record<string, any>[] = [];

    const run = runtime.chatRun("session-1", chatInput("Analyze it"), "run-ask-user", (event) =>
      streamed.push(event),
    );
    await vi.waitFor(() => {
      expect(streamed.some((event) => event.type === "ask_user.prompt")).toBe(true);
    });
    const prompt = streamed.find((event) => event.type === "ask_user.prompt")?.prompt;
    expect(sessionOptions.askUserHandler).toBeTypeOf("function");

    await runtime.answerAskUser("session-1", prompt.id, "AAPL");
    await run;
    expect(streamed.some((event) => event.type === "ask_user.resolved")).toBe(true);
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

  it("enforces the final serialized bootstrap budget including checkpoint duplication", () => {
    const duplicatedEntry = { type: "message", message: { content: "saved research" } };
    const bootstrap = {
      checkpoint: { sessions: [{ content: JSON.stringify(duplicatedEntry) }] },
      snapshot: { entries: [duplicatedEntry] },
    };
    const serializedBytes = Buffer.byteLength(JSON.stringify(bootstrap));

    expect(() => assertHostedBootstrapPersistable(bootstrap, serializedBytes - 1)).toThrow(
      "browser storage limit",
    );
    expect(() => assertHostedBootstrapPersistable(bootstrap, serializedBytes)).not.toThrow();
  });
});

function chatInput(prompt: string) {
  return { prompt, images: [], attachments: [] };
}

function createRuntime(
  overrides: Record<string, unknown> = {},
  database: any = { exportBytes: vi.fn(() => new Uint8Array()), close: vi.fn() },
) {
  const runtime = new (BrowserHostedGuiRuntime as any)(
    {
      cwd: "/workspace",
      sessionDir: "/sessions",
      stateFile: "/state/current.sqlite3",
      modelProvider: "openai",
      modelId: "gpt-5-mini",
      modelCredentials: { openai: "test-key" },
      marketStateDependencies: {
        resolveInstrument: async (symbol: string) => ({
          status: "resolved",
          instrument: { symbol, assetType: "equity", currency: "USD", provider: "test" },
        }),
      },
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
