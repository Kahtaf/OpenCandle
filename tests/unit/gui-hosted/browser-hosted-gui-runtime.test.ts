import { describe, expect, it, vi } from "vitest";
import {
  BrowserHostedGuiRuntime,
  MAX_COMPLETED_CHAT_RESULTS,
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

    const first = runtime.chatRun("session-1", chatInput("First"), "run-1");
    await Promise.resolve();

    await expect(runtime.chatRun("session-1", chatInput("Second"), "run-2")).rejects.toThrow(
      "already active",
    );
    expect(prompt).toHaveBeenCalledTimes(1);

    finishPrompt();
    await first;
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
      action: "add",
      symbol: "MSFT",
    });

    expect(retry).toBe(first);
    expect(runtime.marketState().watchlist).toHaveLength(1);
    expect(runtime.marketState().watchlist[0]).toMatchObject({ symbol: "AAPL" });
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
