import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToolInvokeController, invokeToolFromUi } from "../../../gui/server/invoke-tool.js";
import { createLocalSessionCoordinator } from "../../../gui/server/local-session-coordinator.js";
import {
  acquireWriterLock,
  readWriterLock,
  writerLockScopeForSession,
} from "../../../gui/server/writer-lock.js";

describe("invokeToolFromUi", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;

  beforeEach(() => {
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-gui-invoke-tool-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
  });

  afterEach(() => {
    if (originalEnv == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalEnv;
    }
    rmSync(openCandleHome, { recursive: true, force: true });
  });

  it("appends normalized market-state mutation metadata for UI tool results", async () => {
    const messages: Message[] = [];
    const sessionManager = {
      appendMessage(message: Message) {
        messages.push(message);
      },
    } as unknown as SessionManager;
    const params = Type.Object({
      action: Type.String(),
      symbol: Type.String(),
    });
    const tool: AgentTool<typeof params> = {
      name: "manage_watchlist",
      label: "Watchlist",
      description: "test",
      parameters: params,
      async execute() {
        return {
          content: [{ type: "text", text: "Added AAPL" }],
          details: {
            id: 7,
            instrumentId: 3,
            symbol: "AAPL",
          },
        };
      },
    };

    await invokeToolFromUi(sessionManager, tool, { action: "add", symbol: "AAPL" }, "ui");

    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: "toolResult",
      toolName: "manage_watchlist",
      details: {
        source: "ui",
        args: { action: "add", symbol: "AAPL" },
        value: { id: 7, instrumentId: 3, symbol: "AAPL" },
        stateChange: {
          source: "ui",
          domain: "watchlist",
          action: "add",
          targetType: "watchlist_item",
          targetId: 7,
          instrumentId: 3,
          toolName: "manage_watchlist",
        },
      },
    });
  });

  it("includes target ids for market-state removals that affect multiple rows", async () => {
    const messages: Message[] = [];
    const sessionManager = {
      appendMessage(message: Message) {
        messages.push(message);
      },
    } as unknown as SessionManager;
    const params = Type.Object({
      action: Type.String(),
      symbol: Type.String(),
    });
    const tool: AgentTool<typeof params> = {
      name: "track_portfolio",
      label: "Portfolio",
      description: "test",
      parameters: params,
      async execute() {
        return {
          content: [{ type: "text", text: "Removed VTI" }],
          details: {
            symbol: "VTI",
            removedCount: 2,
            removedLotIds: [4, 5],
            instrumentIds: [9],
          },
        };
      },
    };

    await invokeToolFromUi(sessionManager, tool, { action: "remove", symbol: "VTI" }, "ui");

    expect(messages[1]).toMatchObject({
      role: "toolResult",
      toolName: "track_portfolio",
      details: {
        stateChange: {
          source: "ui",
          domain: "portfolio",
          action: "remove",
          targetType: "portfolio_lot",
          targetIds: [4, 5],
          instrumentIds: [9],
          toolName: "track_portfolio",
        },
      },
    });
  });

  it("sends a tool invocation ack and broadcasts state after UI invocation", async () => {
    const messages: Message[] = [];
    const sentMessages: unknown[] = [];
    const broadcastState = vi.fn();
    const sessionManager = {
      appendMessage(message: Message) {
        messages.push(message);
      },
    } as unknown as SessionManager;
    const params = Type.Object({
      symbol: Type.String(),
    });
    const tool: AgentTool<typeof params> = {
      name: "get_stock_quote",
      label: "Quote",
      description: "test",
      parameters: params,
      async execute() {
        return {
          content: [{ type: "text", text: "AAPL quote" }],
          details: { symbol: "AAPL", price: 190 },
        };
      },
    };
    const controller = createToolInvokeController({
      role: "writer",
      getSessionManager: () => sessionManager,
      broadcastState,
      getTools: () => [tool],
    });

    await controller.handleToolInvokeMessage(
      { send: (message: unknown) => sentMessages.push(message) },
      { requestId: "req-1", toolName: "get_stock_quote", args: { symbol: "AAPL" } },
    );

    expect(messages).toHaveLength(2);
    expect(broadcastState).toHaveBeenCalledOnce();
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({
      type: "tool.invoke.result",
      requestId: "req-1",
      ok: true,
      toolName: "get_stock_quote",
      result: {
        details: { symbol: "AAPL", price: 190 },
        isError: false,
      },
    });
  });

  it("dedupes retried tool invocation messages by action id", async () => {
    const sentMessages: unknown[] = [];
    const broadcastState = vi.fn();
    const sessionManager = {
      getSessionId: () => "session-1",
      appendMessage: vi.fn(),
    } as unknown as SessionManager;
    const params = Type.Object({
      symbol: Type.String(),
    });
    const tool: AgentTool<typeof params> = {
      name: "get_stock_quote",
      label: "Quote",
      description: "test",
      parameters: params,
      async execute() {
        return {
          content: [{ type: "text", text: "AAPL quote" }],
          details: { symbol: "AAPL", price: 190 },
        };
      },
    };
    const invokeTool = vi.fn(invokeToolFromUi);
    const controller = createToolInvokeController({
      role: "writer",
      getSessionManager: () => sessionManager,
      broadcastState,
      getTools: () => [tool],
      invokeTool,
      localSessionCoordinator: createLocalSessionCoordinator(),
    });

    const message = {
      requestId: "req-1",
      actionId: "tool-action-1",
      sessionId: "session-1",
      toolName: "get_stock_quote",
      args: { symbol: "AAPL" },
    };
    await controller.handleToolInvokeMessage(
      { send: (sent: unknown) => sentMessages.push(sent) },
      message,
    );
    await controller.handleToolInvokeMessage(
      { send: (sent: unknown) => sentMessages.push(sent) },
      message,
    );

    expect(invokeTool).toHaveBeenCalledOnce();
    expect(broadcastState).toHaveBeenCalledOnce();
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[1]).toMatchObject({ ok: true, requestId: "req-1" });
  });

  it("proxies tool invocations to the target session coordinator", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-gui-tool-proxy-"));
    const originalFetch = globalThis.fetch;
    try {
      const currentSessionManager = {
        getSessionId: () => "current-session",
        getSessionFile: () => join(dir, "current.jsonl"),
        appendMessage: vi.fn(),
      } as unknown as SessionManager;
      const targetSessionManager = {
        getSessionId: () => "target-session",
        getSessionFile: () => join(dir, "target.jsonl"),
        appendMessage: vi.fn(),
      } as unknown as SessionManager;
      await acquireWriterLock(writerLockScopeForSession(currentSessionManager), "gui", {
        pid: process.pid,
      });
      await acquireWriterLock(writerLockScopeForSession(targetSessionManager), "tui", {
        pid: 999_999,
        coordinatorEndpoint: "http://127.0.0.1:25432",
        coordinatorSecret: "secret",
      });
      const proxiedResult = {
        toolCallId: "remote-tool-call",
        result: { content: [{ type: "text", text: "remote quote" }], details: { symbol: "AAPL" } },
        isError: false,
      };
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ result: proxiedResult }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );
      globalThis.fetch = fetchMock as typeof fetch;
      const params = Type.Object({
        symbol: Type.String(),
      });
      const tool: AgentTool<typeof params> = {
        name: "get_stock_quote",
        label: "Quote",
        description: "test",
        parameters: params,
        async execute() {
          throw new Error("should proxy before local execution");
        },
      };
      const controller = createToolInvokeController({
        role: "writer",
        getSessionManager: () => currentSessionManager,
        broadcastState: vi.fn(),
        getTools: () => [tool],
        resolveSessionManager: async () => targetSessionManager,
      });

      await expect(
        controller.handleToolInvoke("get_stock_quote", { symbol: "AAPL" }, "target-session"),
      ).resolves.toEqual(proxiedResult);
      expect(fetchMock).toHaveBeenCalledWith(
        new URL("http://127.0.0.1:25432/api/local-coordinator/tool-invoke"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-opencandle-coordinator-secret": "secret",
          }),
          body: JSON.stringify({
            sessionId: "target-session",
            toolName: "get_stock_quote",
            args: { symbol: "AAPL" },
          }),
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("routes request-scoped tool invocations to the requested session", async () => {
    const sentMessages: unknown[] = [];
    const broadcastState = vi.fn();
    const targetSessionSnapshot = vi.fn();
    const currentSessionManager = {
      getSessionId: () => "current-session",
      getSessionFile: () => "/tmp/current-session.jsonl",
      appendMessage: vi.fn(),
    } as unknown as SessionManager;
    const targetSessionManager = {
      getSessionId: () => "target-session",
      getSessionFile: () => "/tmp/current-session.jsonl",
      appendMessage: vi.fn(),
    } as unknown as SessionManager;
    const params = Type.Object({
      symbol: Type.String(),
    });
    const tool: AgentTool<typeof params> = {
      name: "get_stock_quote",
      label: "Quote",
      description: "test",
      parameters: params,
      async execute() {
        return {
          content: [{ type: "text", text: "NVDA quote" }],
          details: { symbol: "NVDA", price: 200 },
        };
      },
    };
    const invokeTool = vi.fn(invokeToolFromUi);
    const controller = createToolInvokeController({
      role: "writer",
      getSessionManager: () => currentSessionManager,
      resolveSessionManager: vi.fn(async () => targetSessionManager),
      broadcastState,
      broadcastSessionSnapshot: targetSessionSnapshot,
      getTools: () => [tool],
      invokeTool,
    });

    await controller.handleToolInvokeMessage(
      { send: (message: unknown) => sentMessages.push(message) },
      {
        requestId: "req-target",
        sessionId: "target-session",
        toolName: "get_stock_quote",
        args: { symbol: "NVDA" },
      },
    );

    expect(invokeTool).toHaveBeenCalledWith(
      targetSessionManager,
      tool,
      { symbol: "NVDA" },
      "ui",
      expect.any(Object),
    );
    expect(broadcastState).toHaveBeenCalledOnce();
    expect(sentMessages[0]).toMatchObject({ ok: true, requestId: "req-target" });
  });

  it("refreshes and releases non-current session locks during direct tool invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-25T12:00:00.000Z"));
    try {
      const currentSessionManager = {
        getSessionId: () => "current-session",
        getSessionFile: () => join(openCandleHome, "current-session.jsonl"),
        appendMessage: vi.fn(),
      } as unknown as SessionManager;
      const targetSessionManager = {
        getSessionId: () => "target-session",
        getSessionFile: () => join(openCandleHome, "target-session.jsonl"),
        appendMessage: vi.fn(),
      } as unknown as SessionManager;
      const params = Type.Object({
        symbol: Type.String(),
      });
      const tool: AgentTool<typeof params> = {
        name: "get_stock_quote",
        label: "Quote",
        description: "test",
        parameters: params,
        async execute() {
          throw new Error("invokeTool mock handles execution");
        },
      };
      let finishInvoke: (() => void) | undefined;
      const invokeTool = vi.fn(
        () =>
          new Promise<Awaited<ReturnType<typeof invokeToolFromUi>>>((resolve) => {
            finishInvoke = () =>
              resolve({
                toolCallId: "tool-call-1",
                result: { content: [{ type: "text", text: "NVDA quote" }] },
                isError: false,
              });
          }),
      );
      const controller = createToolInvokeController({
        role: "writer",
        getSessionManager: () => currentSessionManager,
        resolveSessionManager: vi.fn(async () => targetSessionManager),
        broadcastState: vi.fn(),
        getTools: () => [tool],
        invokeTool,
      });

      const invokePromise = controller.handleToolInvoke(
        "get_stock_quote",
        {
          symbol: "NVDA",
        },
        "target-session",
      );
      await vi.waitFor(() => expect(invokeTool).toHaveBeenCalledOnce());

      const lockScope = writerLockScopeForSession(targetSessionManager);
      const acquiredLock = readWriterLock(lockScope);
      expect(acquiredLock).not.toBeNull();

      vi.setSystemTime(new Date(Date.parse(acquiredLock?.lastHeartbeat ?? "") + 5000));
      await vi.advanceTimersByTimeAsync(5000);

      const refreshedLock = readWriterLock(lockScope);
      expect(Date.parse(refreshedLock?.lastHeartbeat ?? "")).toBeGreaterThan(
        Date.parse(acquiredLock?.lastHeartbeat ?? ""),
      );

      finishInvoke?.();
      await invokePromise;
      expect(readWriterLock(lockScope)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes the GUI ask handler through direct UI tool invocation", async () => {
    const messages: Message[] = [];
    const broadcastState = vi.fn();
    const askUserHandler = vi.fn(async () => ({
      answer: "Skip X/Twitter once",
      cancelled: false,
    }));
    const sessionManager = {
      appendMessage(message: Message) {
        messages.push(message);
      },
    } as unknown as SessionManager;
    const params = Type.Object({
      query: Type.String(),
    });
    const tool: AgentTool<typeof params> = {
      name: "get_twitter_sentiment",
      label: "Twitter Sentiment",
      description: "test",
      parameters: params,
      async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
        const result = await ctx.askUserHandler({
          question: "Install twitter-cli?",
          questionType: "select",
          options: ["Skip X/Twitter once"],
        });
        return {
          content: [{ type: "text", text: result.answer ?? "cancelled" }],
          details: null,
        };
      },
    } as AgentTool<typeof params> & {
      execute(
        toolCallId: string,
        params: { query: string },
        signal: AbortSignal | undefined,
        onUpdate: undefined,
        ctx: { askUserHandler: typeof askUserHandler },
      ): ReturnType<AgentTool<typeof params>["execute"]>;
    };
    const controller = createToolInvokeController({
      role: "writer",
      getSessionManager: () => sessionManager,
      broadcastState,
      getTools: () => [tool],
      askUserHandler,
    });

    const result = await controller.handleToolInvoke("get_twitter_sentiment", { query: "AAPL" });

    expect(askUserHandler).toHaveBeenCalledOnce();
    expect(result.result.content[0]).toMatchObject({
      type: "text",
      text: "Skip X/Twitter once",
    });
    expect(messages[1]).toMatchObject({
      role: "toolResult",
      toolName: "get_twitter_sentiment",
    });
  });

  it("notifies callers after successful market-state mutations", async () => {
    const messages: Message[] = [];
    const sentMessages: unknown[] = [];
    const broadcastState = vi.fn();
    const onMarketStateChanged = vi.fn();
    const sessionManager = {
      appendMessage(message: Message) {
        messages.push(message);
      },
    } as unknown as SessionManager;
    const params = Type.Object({
      action: Type.String(),
      symbol: Type.String(),
    });
    const tool: AgentTool<typeof params> = {
      name: "manage_watchlist",
      label: "Watchlist",
      description: "test",
      parameters: params,
      async execute() {
        return {
          content: [{ type: "text", text: "Added AAPL" }],
          details: { id: 7, instrumentId: 3, symbol: "AAPL" },
        };
      },
    };
    const controller = createToolInvokeController({
      role: "writer",
      getSessionManager: () => sessionManager,
      broadcastState,
      onMarketStateChanged,
      getTools: () => [tool],
    });

    await controller.handleToolInvokeMessage(
      { send: (message: unknown) => sentMessages.push(message) },
      { requestId: "req-3", toolName: "manage_watchlist", args: { action: "add", symbol: "AAPL" } },
    );

    expect(onMarketStateChanged).toHaveBeenCalledOnce();
    expect(broadcastState).toHaveBeenCalledOnce();
    expect(sentMessages[0]).toMatchObject({ ok: true, toolName: "manage_watchlist" });
  });

  it("sends request-scoped tool invocation errors without throwing", async () => {
    const sentMessages: unknown[] = [];
    const controller = createToolInvokeController({
      role: "writer",
      getSessionManager: () => ({}) as SessionManager,
      broadcastState: vi.fn(),
      getTools: () => [],
    });

    await controller.handleToolInvokeMessage(
      { send: (message: unknown) => sentMessages.push(message) },
      { requestId: "req-2", toolName: "missing_tool", args: {} },
    );

    expect(sentMessages).toEqual([
      {
        type: "tool.invoke.result",
        requestId: "req-2",
        ok: false,
        toolName: "missing_tool",
        error: { message: "Unknown tool: missing_tool" },
      },
    ]);
  });
});
