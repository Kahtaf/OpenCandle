import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertHostedBootstrapPersistable,
  BrowserHostedGuiRuntime,
  MAX_COMPLETED_CHAT_RESULTS,
  MAX_PI_SESSION_CACHE_SIZE,
  selectSessionCheckpoints,
  serializeHostedBlockedProvider,
} from "../../../gui/hosted/runtime/browser-hosted-gui-runtime.js";
import { SessionManager } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js";
import { resolveHostedBrowserCapabilityReport } from "../../../src/onboarding/providers.js";
import {
  hasPendingSessionAction,
  recordPendingSessionAction,
} from "../../../src/pi/session-action-dedupe.js";
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

  it("rejects renaming a session while its chat run is active", async () => {
    let finishPrompt!: () => void;
    const dispose = vi.fn();
    const prompt = vi.fn(
      () =>
        new Promise<{ sessionId: string }>((resolve) => {
          finishPrompt = () => resolve({ sessionId: "session-1" });
        }),
    );
    const runtime = createRuntime({
      createPiSession: vi.fn(async () => ({ prompt, dispose })),
    });

    const run = runtime.chatRun("session-1", chatInput("First"), "run-rename");
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());

    await expect(runtime.renameSession("session-1", "Renamed")).rejects.toThrow("active");
    expect(dispose).not.toHaveBeenCalled();

    finishPrompt();
    await run;
  });

  it("rechecks session activity after resolving a rename target", async () => {
    const runtime = createRuntime();
    let resolveManager!: (manager: Record<string, unknown>) => void;
    const appendSessionInfo = vi.fn();
    (runtime as any).resolveManager = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveManager = resolve;
        }),
    );

    const rename = runtime.renameSession("session-1", "Renamed");
    await vi.waitFor(() => expect((runtime as any).resolveManager).toHaveBeenCalledOnce());
    (runtime as any).activeSessionRuns.add("session-1");
    resolveManager({
      getSessionId: () => "session-1",
      getSessionFile: () => "/sessions/session-1.jsonl",
      appendSessionInfo,
    });

    await expect(rename).rejects.toThrow("active");
    expect(appendSessionInfo).not.toHaveBeenCalled();
  });

  it("rejects model and relay reconfiguration while any chat run is active", async () => {
    let finishPrompt!: () => void;
    const dispose = vi.fn();
    const prompt = vi.fn(
      () =>
        new Promise<{ sessionId: string }>((resolve) => {
          finishPrompt = () => resolve({ sessionId: "session-1" });
        }),
    );
    const runtime = createRuntime({
      createPiSession: vi.fn(async () => ({ prompt, dispose })),
    });

    const run = runtime.chatRun("session-1", chatInput("First"), "run-reconfigure");
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());

    expect(() => runtime.configureModel("openai", "gpt-5", "new-key")).toThrow("active");
    expect(() => runtime.configureRelayProviders(["yahoo"])).toThrow("active");
    expect(dispose).not.toHaveBeenCalled();

    finishPrompt();
    await run;
  });

  it("rejects thinking-level changes while that session has an active turn", async () => {
    let finishPrompt!: () => void;
    const setThinkingLevel = vi.fn();
    const prompt = vi.fn(
      () =>
        new Promise<{ sessionId: string }>((resolve) => {
          finishPrompt = () => resolve({ sessionId: "session-1" });
        }),
    );
    const runtime = createRuntime({
      createPiSession: vi.fn(async () => ({
        prompt,
        setThinkingLevel,
        dispose: vi.fn(),
      })),
    });

    const run = runtime.chatRun("session-1", chatInput("First"), "run-thinking");
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());

    await expect(runtime.configureThinking("high")).rejects.toThrow("active");
    expect(setThinkingLevel).not.toHaveBeenCalled();

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

  it("serializes blocked providers as local-only catalog rows instead of omitting them", () => {
    const report = resolveHostedBrowserCapabilityReport(["yahoo"]);
    const blockedIds = report.unavailable.map((provider) => provider.id);
    expect(blockedIds).toContain("reddit");
    expect(blockedIds).toContain("twitter");
    const rows = report.unavailable.map(serializeHostedBlockedProvider);
    for (const row of rows) {
      expect(row.browserTransport).toBe("blocked");
      expect(row.hosted).toBe(true);
      expect(row.id).toBeTruthy();
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

  it("waits for a durable pending-action checkpoint before starting paid work", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-hosted-checkpoint-"));
    writeFileSync(
      join(sessionDir, "session-1.jsonl"),
      `${JSON.stringify({ type: "session", id: "session-1" })}\n`,
    );
    let releaseCheckpoint!: () => void;
    const checkpointPersisted = new Promise<void>((resolve) => {
      releaseCheckpoint = resolve;
    });
    const prompt = vi.fn(async () => ({ sessionId: "session-1" }));
    const persistCheckpoint = vi.fn(async () => checkpointPersisted);
    const runtime = createRuntime({
      sessionDir,
      createPiSession: vi.fn(async () => ({ prompt, dispose: vi.fn() })),
    });

    const run = runtime.chatRun(
      "session-1",
      chatInput("First"),
      "run-durable",
      undefined,
      undefined,
      persistCheckpoint,
    );
    await vi.waitFor(() => expect(persistCheckpoint).toHaveBeenCalledOnce());
    expect(prompt).not.toHaveBeenCalled();
    expect(JSON.stringify(persistCheckpoint.mock.calls[0]?.[0])).toContain("run-durable");

    releaseCheckpoint();
    await run;
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("does not checkpoint acceptance until Pi finishes the durable user message", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-hosted-accepted-checkpoint-"));
    writeFileSync(
      join(sessionDir, "session-1.jsonl"),
      `${JSON.stringify({ type: "session", id: "session-1" })}\n`,
    );
    let listener: ((event: Record<string, unknown>) => void) | undefined;
    const persistCheckpoint = vi.fn(async () => undefined);
    const prompt = vi.fn(async () => {
      listener?.({
        type: "message_start",
        message: { role: "user", content: "First", timestamp: Date.now() },
      });
      await Promise.resolve();
      expect(persistCheckpoint).toHaveBeenCalledTimes(1);
      listener?.({
        type: "message_end",
        message: { role: "user", content: "First", timestamp: Date.now() },
      });
      await Promise.resolve();
      expect(persistCheckpoint).toHaveBeenCalledTimes(1);
      return { sessionId: "session-1" };
    });
    const runtime = createRuntime({
      sessionDir,
      createPiSession: vi.fn(async () => ({
        prompt,
        subscribe: (next: typeof listener) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
        dispose: vi.fn(),
      })),
    });

    await runtime.chatRun(
      "session-1",
      chatInput("First"),
      "run-accepted",
      undefined,
      undefined,
      persistCheckpoint,
    );
    expect(persistCheckpoint).toHaveBeenCalledTimes(2);
  });

  it("checkpoints market-state mutations made during a chat run", async () => {
    const database = await createSqlJsStateDatabase();
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-hosted-market-checkpoint-"));
    writeFileSync(
      join(sessionDir, "session-1.jsonl"),
      `${JSON.stringify({ type: "session", id: "session-1" })}\n`,
    );
    let finishPrompt!: () => void;
    const prompt = vi.fn(
      () =>
        new Promise<{ sessionId: string }>((resolve) => {
          finishPrompt = () => resolve({ sessionId: "session-1" });
        }),
    );
    const persistCheckpoint = vi.fn(async () => undefined);
    const runtime = createRuntime(
      {
        sessionDir,
        createPiSession: vi.fn(async () => ({ prompt, dispose: vi.fn() })),
      },
      database,
    );

    const run = runtime.chatRun(
      "session-1",
      chatInput("Add AAPL to my watchlist"),
      "run-market-state",
      undefined,
      undefined,
      persistCheckpoint,
    );
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    await runtime.invokeTool("session-1", "tool-market-state", "manage_watchlist", {
      action: "add",
      symbol: "AAPL",
    });
    finishPrompt();
    await run;

    expect(persistCheckpoint.mock.calls.at(-1)?.[0]).toMatchObject({
      marketState: {
        watchlist: [expect.objectContaining({ symbol: "AAPL" })],
      },
    });
    database.close();
  });

  it("accepts a failed paid turn when Pi already persisted the user message", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-hosted-provider-failure-"));
    const sessionFile = join(sessionDir, "session-1.jsonl");
    writeFileSync(sessionFile, `${JSON.stringify({ type: "session", id: "session-1" })}\n`);
    const entries: Array<Record<string, unknown>> = [];
    const prompt = vi.fn(async () => {
      entries.push({ type: "message", message: { role: "user", content: "First" } });
      throw new Error("provider failed");
    });
    const persistCheckpoint = vi.fn(async () => undefined);
    const runtime = createRuntime({
      sessionDir,
      createPiSession: vi.fn(async () => ({ prompt, dispose: vi.fn() })),
    });
    const staleManager = {
      getSessionId: () => "session-1",
      getSessionFile: () => sessionFile,
      getSessionDir: () => sessionDir,
      getEntries: () => [],
    };
    const refreshedManager = {
      ...staleManager,
      getEntries: () => entries,
    };
    (runtime as any).resolveManager = vi
      .fn()
      .mockResolvedValueOnce(staleManager)
      .mockResolvedValue(refreshedManager);

    await expect(
      runtime.chatRun(
        "session-1",
        chatInput("First"),
        "run-provider-failure",
        undefined,
        undefined,
        persistCheckpoint,
      ),
    ).rejects.toThrow("provider failed");
    expect(persistCheckpoint).toHaveBeenCalledTimes(2);

    await expect(
      runtime.chatRun("session-1", chatInput("First"), "run-provider-failure"),
    ).resolves.toBeTruthy();
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("keeps paid work ambiguous when the canonical session cannot be inspected after failure", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-hosted-ambiguous-failure-"));
    const sessionFile = join(sessionDir, "session-1.jsonl");
    writeFileSync(sessionFile, `${JSON.stringify({ type: "session", id: "session-1" })}\n`);
    const manager = {
      getSessionId: () => "session-1",
      getSessionFile: () => sessionFile,
      getSessionDir: () => sessionDir,
      getEntries: () => [],
    };
    const runtime = createRuntime({
      sessionDir,
      createPiSession: vi.fn(async () => ({
        prompt: vi.fn(async () => {
          throw new Error("provider failed");
        }),
        dispose: vi.fn(),
      })),
    });
    (runtime as any).resolveManager = vi
      .fn()
      .mockResolvedValueOnce(manager)
      .mockRejectedValueOnce(new Error("session unavailable"));

    await expect(
      runtime.chatRun("session-1", chatInput("First"), "run-ambiguous-failure"),
    ).rejects.toThrow("provider failed");

    expect(hasPendingSessionAction(manager as any, "run-ambiguous-failure")).toBe(true);
  });

  it("checkpoints removal of a durable admission when Pi fails before persisting the prompt", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-hosted-prestart-failure-"));
    const sessionFile = join(sessionDir, "session-1.jsonl");
    writeFileSync(sessionFile, `${JSON.stringify({ type: "session", id: "session-1" })}\n`);
    const manager = {
      getSessionId: () => "session-1",
      getSessionFile: () => sessionFile,
      getSessionDir: () => sessionDir,
      getEntries: () => [],
    };
    const persistCheckpoint = vi.fn(async () => undefined);
    const runtime = createRuntime({
      sessionDir,
      createPiSession: vi.fn(async () => ({
        prompt: vi.fn(async () => {
          throw new Error("provider rejected before prompt");
        }),
        dispose: vi.fn(),
      })),
    });
    (runtime as any).resolveManager = vi.fn(async () => manager);

    await expect(
      runtime.chatRun(
        "session-1",
        chatInput("First"),
        "run-prestart-failure",
        undefined,
        undefined,
        persistCheckpoint,
      ),
    ).rejects.toThrow("provider rejected before prompt");

    expect(persistCheckpoint).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(persistCheckpoint.mock.calls[1]?.[0])).not.toContain(
      "run-prestart-failure",
    );
  });

  it("aborts the Pi turn when streamed browser persistence fails", async () => {
    const prompt = vi.fn(
      async (_prompt: string, signal: AbortSignal | undefined): Promise<{ sessionId: string }> => {
        await vi.waitFor(() => expect(signal?.aborted).toBe(true));
        throw signal?.reason;
      },
    );
    const runtime = createRuntime({
      createPiSession: vi.fn(async () => ({ prompt, dispose: vi.fn() })),
    });

    await expect(
      runtime.chatRun(
        "session-1",
        chatInput("Persist this"),
        "run-persistence-failure",
        async (event) => {
          if (event.type === "run.started") throw new Error("browser persistence failed");
        },
      ),
    ).rejects.toThrow("browser persistence failed");
  });

  it("uses the canonical session action marker after a hosted runtime restart", async () => {
    const prompt = vi.fn(async () => ({ sessionId: "session-1", turnEvents: [] }));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-hosted-actions-"));
    const sessionFile = join(sessionDir, "session-1.jsonl");
    const manager = {
      getSessionFile: () => sessionFile,
      getSessionDir: () => sessionDir,
      getEntries: () => [],
    };
    const first = createRuntime({
      sessionDir,
      createPiSession: vi.fn(async () => ({ prompt, dispose: vi.fn() })),
    });
    (first as any).resolveManager = vi.fn(async () => manager);
    await first.chatRun("session-1", chatInput("First"), "run-restart");

    const secondPrompt = vi.fn(async () => ({ sessionId: "session-1", turnEvents: [] }));
    const second = createRuntime({
      sessionDir,
      createPiSession: vi.fn(async () => ({ prompt: secondPrompt, dispose: vi.fn() })),
    });
    (second as any).resolveManager = vi.fn(async () => manager);

    await expect(second.chatRun("session-1", chatInput("First"), "run-restart")).resolves.toEqual(
      expect.objectContaining({ events: [] }),
    );
    expect(secondPrompt).not.toHaveBeenCalled();
    await expect(second.chatRun("session-1", chatInput("Changed"), "run-restart")).rejects.toThrow(
      "different input",
    );
  });

  it("reports a durable pending run as ambiguous without paying twice", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-hosted-pending-recovery-"));
    const sessionFile = join(sessionDir, "session-1.jsonl");
    writeFileSync(sessionFile, `${JSON.stringify({ type: "session", id: "session-1" })}\n`);
    const manager = { getSessionFile: () => sessionFile, getSessionDir: () => sessionDir };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(chatInput("First")))
      .digest("hex");
    recordPendingSessionAction(manager, "run-recover", fingerprint, { durable: true });
    const prompt = vi.fn(async () => ({ sessionId: "session-1" }));
    const persistCheckpoint = vi.fn(async () => undefined);
    const runtime = createRuntime({
      sessionDir,
      createPiSession: vi.fn(async () => ({ prompt, dispose: vi.fn() })),
    });
    (runtime as any).resolveManager = vi.fn(async () => manager);

    await expect(
      runtime.chatRun(
        "session-1",
        chatInput("First"),
        "run-recover",
        undefined,
        undefined,
        persistCheckpoint,
      ),
    ).rejects.toThrow("may have started");
    expect(prompt).not.toHaveBeenCalled();
    expect(persistCheckpoint).not.toHaveBeenCalled();
  });

  it("reuses one Pi agent session for consecutive turns in the same hosted session", async () => {
    const prompt = vi.fn(async () => ({ sessionId: "session-1", turnEvents: [] }));
    const dispose = vi.fn();
    const createPiSession = vi.fn(async () => ({
      prompt,
      subscribe: vi.fn(() => vi.fn()),
      dispose,
    }));
    const runtime = createRuntime({ createPiSession });

    await runtime.chatRun("session-1", chatInput("First"), "run-1");
    await runtime.chatRun("session-1", chatInput("Second"), "run-2");

    expect(createPiSession).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(dispose).not.toHaveBeenCalled();

    runtime.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("streams Pi message deltas through the same live event adapter as local web", async () => {
    let listener: ((event: Record<string, unknown>) => void) | undefined;
    const prompt = vi.fn(async () => {
      listener?.({
        type: "message_start",
        message: { role: "assistant", content: [], timestamp: Date.now() },
      });
      listener?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Live" },
      });
      listener?.({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Live" }],
          timestamp: Date.now(),
        },
      });
      return { sessionId: "session-1", turnEvents: [] };
    });
    const runtime = createRuntime({
      createPiSession: vi.fn(async () => ({
        prompt,
        subscribe: (next: typeof listener) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
        dispose: vi.fn(),
      })),
    });
    const events: Record<string, unknown>[] = [];

    await runtime.chatRun("session-1", chatInput("Stream it"), "run-live", (event) => {
      events.push(event);
    });

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.created",
      "message.delta",
      "message.completed",
      "run.completed",
    ]);
    expect(events.find((event) => event.type === "message.delta")).toMatchObject({
      runId: "run-live",
      sessionId: "session-1",
      text: "Live",
    });
  });

  it("keeps failure events ordered after already-streamed Pi events", async () => {
    let listener: ((event: Record<string, unknown>) => void) | undefined;
    const runtime = createRuntime({
      createPiSession: vi.fn(async () => ({
        prompt: async () => {
          listener?.({
            type: "message_start",
            message: { role: "assistant", content: [], timestamp: Date.now() },
          });
          listener?.({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "Partial" },
          });
          throw new Error("provider failed");
        },
        subscribe: (next: typeof listener) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
        dispose: vi.fn(),
      })),
    });
    const events: Record<string, unknown>[] = [];

    await expect(
      runtime.chatRun("session-1", chatInput("Stream it"), "run-failed", (event) => {
        events.push(event);
      }),
    ).rejects.toThrow("provider failed");

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.created",
      "message.delta",
      "run.failed",
    ]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
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

  it("joins identical chat retries that race session lookup", async () => {
    const prompt = vi.fn(async () => ({ sessionId: "session-1" }));
    const runtime = createRuntime({
      createPiSession: vi.fn(async () => ({ prompt, dispose: vi.fn() })),
    });

    const first = runtime.chatRun("session-1", chatInput("First"), "run-racing-lookup");
    const retry = runtime.chatRun("session-1", chatInput("First"), "run-racing-lookup");
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
    const persistCheckpoint = vi.fn(async () => undefined);
    (runtime as any).currentSessionId = "session-1";

    const run = runtime.chatRun(
      "session-1",
      chatInput("First"),
      "run-background",
      undefined,
      undefined,
      persistCheckpoint,
    );
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    (runtime as any).currentSessionId = "session-2";
    finishPrompt();
    await run;

    expect((runtime as any).currentSessionId).toBe("session-2");
    expect((runtime as any).buildBootstrap).toHaveBeenLastCalledWith(expect.anything(), false);
    expect(persistCheckpoint.mock.calls.at(-1)?.[0].sessionId).toBe("session-2");
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
    expect(first).toMatchObject({
      sessionId: "session-1",
      checkpoint: expect.any(Object),
      result: expect.any(Object),
    });
    database.close();
  });

  it("does not record market-state mutations when the shared UI opts out", async () => {
    const database = await createSqlJsStateDatabase();
    const runtime = createRuntime({}, database);
    const appendMessage = vi.fn();
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-hosted-no-transcript-"));
    (runtime as any).resolveManager = vi.fn(async () => ({
      getSessionId: () => "session-1",
      getSessionFile: () => join(sessionDir, "session-1.jsonl"),
      getSessionDir: () => sessionDir,
      getEntries: () => [],
      appendMessage,
    }));

    await runtime.invokeTool(
      "session-1",
      "action-no-transcript",
      "manage_watchlist",
      { action: "add", symbol: "AAPL" },
      false,
    );

    expect(appendMessage).not.toHaveBeenCalled();
    expect(runtime.marketState().watchlist).toHaveLength(1);
    database.close();
  });

  it("includes durable market state in persisted bootstraps", async () => {
    const database = await createSqlJsStateDatabase();
    const runtime = createRuntime({}, database);

    await runtime.invokeTool("session-1", "action-1", "manage_watchlist", {
      action: "add",
      symbol: "AAPL",
    });

    await expect(runtime.bootstrap()).resolves.toMatchObject({
      marketState: {
        watchlist: [expect.objectContaining({ symbol: "AAPL" })],
      },
    });
    database.close();
  });

  it("validates direct tool arguments against the canonical tool schema", async () => {
    const database = await createSqlJsStateDatabase();
    const runtime = createRuntime({}, database);

    await expect(
      runtime.invokeTool("session-1", "action-invalid", "manage_watchlist", {
        action: "add",
        symbol: 42,
      }),
    ).rejects.toThrow("Expected string");

    expect(runtime.marketState().watchlist).toHaveLength(0);
    database.close();
  });

  it("recomputes needs-input tool outcomes after a hosted runtime restart", async () => {
    const database = await createSqlJsStateDatabase();
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-hosted-needs-input-"));
    const resolveInstrument = vi.fn(async (query: string) => ({
      status: "needs_selection" as const,
      query,
      candidates: [{ symbol: "SHOP", name: "Shopify", exchange: "NASDAQ" }],
    }));
    const overrides = {
      sessionDir,
      marketStateDependencies: { resolveInstrument },
    };
    const args = { action: "add", symbol: "SHOP" };

    const first = await createRuntime(overrides, database).invokeTool(
      "session-1",
      "action-needs-selection",
      "manage_watchlist",
      args,
    );
    const restarted = await createRuntime(overrides, database).invokeTool(
      "session-1",
      "action-needs-selection",
      "manage_watchlist",
      args,
    );

    expect((first.result as any).result.details.status).toBe("needs_selection");
    expect((restarted.result as any).result.details.status).toBe("needs_selection");
    expect(resolveInstrument).toHaveBeenCalledTimes(2);
    database.close();
  });

  it("retries only persistence after a mutation flush fails", async () => {
    const database = await createSqlJsStateDatabase();
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-hosted-persistence-retry-"));
    const runtime = createRuntime({ sessionDir }, database);
    const flushState = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("storage full");
      })
      .mockImplementation(() => undefined);
    (runtime as any).flushState = flushState;

    await expect(
      runtime.invokeTool("session-1", "action-1", "manage_watchlist", {
        action: "add",
        symbol: "AAPL",
      }),
    ).rejects.toThrow("storage full");
    expect(runtime.marketState().watchlist).toHaveLength(1);

    await expect(
      runtime.invokeTool("session-1", "action-1", "manage_watchlist", {
        action: "add",
        symbol: "AAPL",
      }),
    ).resolves.toBeTruthy();
    expect(runtime.marketState().watchlist).toHaveLength(1);
    expect(flushState).toHaveBeenCalledTimes(2);

    const restarted = createRuntime({ sessionDir }, database);
    await expect(
      restarted.invokeTool("session-1", "action-1", "manage_watchlist", {
        action: "add",
        symbol: "AAPL",
      }),
    ).resolves.toMatchObject({ result: { status: "already_accepted" } });
    expect(restarted.marketState().watchlist).toHaveLength(1);
    database.close();
  });

  it("single-flights concurrent Pi session creation for one session", async () => {
    let finishCreate!: (session: { dispose: ReturnType<typeof vi.fn> }) => void;
    const createPiSession = vi.fn(
      () =>
        new Promise<{ dispose: ReturnType<typeof vi.fn> }>((resolve) => {
          finishCreate = resolve;
        }),
    );
    const runtime = createRuntime({ createPiSession });

    const first = (runtime as any).getOrCreatePiSession(
      "session-1",
      "/sessions/session-1.jsonl",
      "openai",
      "gpt-5-mini",
      { openai: "test-key" },
    );
    const second = (runtime as any).getOrCreatePiSession(
      "session-1",
      "/sessions/session-1.jsonl",
      "openai",
      "gpt-5-mini",
      { openai: "test-key" },
    );
    await vi.waitFor(() => expect(createPiSession).toHaveBeenCalledOnce());
    const session = { dispose: vi.fn() };
    finishCreate(session);

    await expect(Promise.all([first, second])).resolves.toEqual([session, session]);
  });

  it("bounds the reusable Pi session cache and disposes the least-recent session", async () => {
    const sessions = Array.from({ length: MAX_PI_SESSION_CACHE_SIZE + 1 }, () => ({
      dispose: vi.fn(),
    }));
    const createPiSession = vi.fn(async () => sessions[createPiSession.mock.calls.length - 1]);
    const runtime = createRuntime({ createPiSession });

    for (let index = 0; index < sessions.length; index += 1) {
      await (runtime as any).getOrCreatePiSession(
        `session-${index}`,
        `/sessions/session-${index}.jsonl`,
        "openai",
        "gpt-5-mini",
        { openai: "test-key" },
      );
    }

    expect((runtime as any).piSessions.size).toBe(MAX_PI_SESSION_CACHE_SIZE);
    expect(sessions[0]?.dispose).toHaveBeenCalledOnce();
    expect(sessions.at(-1)?.dispose).not.toHaveBeenCalled();
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

  it("single-flights identical tool actions that race session lookup", async () => {
    const database = await createSqlJsStateDatabase();
    const runtime = createRuntime({}, database);
    const args = {
      action: "add",
      symbol: "AAPL",
      shares: 2,
      avg_cost: 180,
      currency: "USD",
    };

    const first = runtime.invokeTool("session-1", "action-race", "track_portfolio", args);
    const retry = runtime.invokeTool("session-1", "action-race", "track_portfolio", args);
    const [firstResult, retryResult] = await Promise.all([first, retry]);

    expect(retryResult).toBe(firstResult);
    expect(runtime.marketState().portfolio).toHaveLength(1);
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

    expect(prompt).toHaveBeenCalledWith("Review this", expect.any(AbortSignal), [
      { type: "image", ...image },
    ]);
    expect(prompt.mock.calls[0]?.[1].aborted).toBe(false);
  });

  it("preserves the original prompt and attachment labels in canonical Pi history", async () => {
    const markOriginalInput = vi.fn();
    const database = await createSqlJsStateDatabase();
    const runtime = createRuntime(
      {
        createPiSession: vi.fn(async () => ({
          prompt: vi.fn(async () => ({ sessionId: "session-1" })),
          markOriginalInput,
          dispose: vi.fn(),
        })),
      },
      database,
    );
    const image = { data: Buffer.from("png").toString("base64"), mimeType: "image/png" };
    await runtime.invokeTool("session-1", "holding-1", "track_portfolio", {
      action: "add",
      symbol: "MSFT",
      shares: 2,
      avg_cost: 300,
      currency: "USD",
      unverified_exact_symbol: true,
    });

    await runtime.chatRun(
      "session-1",
      {
        prompt: "Review my context",
        images: [image],
        attachments: [{ kind: "portfolio", id: "default" }],
      },
      "run-attachments",
    );

    expect(markOriginalInput).toHaveBeenCalledWith("Review my context", [
      { kind: "image", label: "image/png #1" },
      { kind: "portfolio", label: "Portfolio" },
    ]);
    database.close();
  });

  it("round-trips ask_user through the same GUI prompt contract", async () => {
    let sessionOptions: any;
    let listener: ((event: Record<string, unknown>) => void) | undefined;
    const createPiSession = vi.fn(async (options) => {
      sessionOptions = options;
      return {
        prompt: vi.fn(async () => {
          listener?.({
            type: "message_start",
            message: { role: "assistant", content: [], timestamp: Date.now() },
          });
          const result = await options.askUserHandler({
            question: "Which ticker?",
            questionType: "text",
            reason: "A ticker is required",
          });
          expect(result).toEqual({ answer: "AAPL", cancelled: false });
          listener?.({
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Continuing with AAPL" }],
              timestamp: Date.now(),
            },
          });
          return { sessionId: "session-1" };
        }),
        subscribe: (next: typeof listener) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
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
    expect(streamed.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
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
  const sessionDir = String(
    overrides.sessionDir ?? mkdtempSync(join(tmpdir(), "opencandle-hosted-runtime-")),
  );
  const runtime = new (BrowserHostedGuiRuntime as any)(
    {
      cwd: "/workspace",
      sessionDir,
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
  if (typeof database.prepare !== "function") {
    runtime.marketState = vi.fn(() => ({
      watchlists: [],
      watchlist: [],
      portfolios: [],
      portfolio: [],
    }));
  }
  runtime.resolveManager = vi.fn(async () => ({
    getSessionId: () => "session-1",
    getSessionFile: () => join(sessionDir, "session-1.jsonl"),
    getSessionDir: () => sessionDir,
    getEntries: () => [],
    appendMessage: vi.fn(),
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
    marketState: runtime.marketState(),
    checkpoint: {
      sessions: [],
      state: { format: "sqlite3", filename: "current.sqlite3", contentBase64: "" },
    },
  }));
  runtime.flushState = vi.fn();
  return runtime;
}
