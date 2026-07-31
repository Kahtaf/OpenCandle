import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  drainOpenCandleCustomEntries,
  runOpenCandleSession,
  toEvalTrace,
} from "../../harness/opencandle-runner.js";
import type { AgentTrace } from "../../harness/types.js";
import { createTestModelRuntime } from "../../helpers/pi-model-runtime.js";

const { createOpenCandleSessionMock } = vi.hoisted(() => ({
  createOpenCandleSessionMock: vi.fn(),
}));

vi.mock("../../../src/index.js", () => ({
  createOpenCandleSession: createOpenCandleSessionMock,
}));

describe("OpenCandle harness runner helpers", () => {
  it("drains only opencandle custom entries in append order", () => {
    const sm = SessionManager.inMemory();
    sm.appendCustomEntry("opencandle-router", { output: { route: "workflow" } });
    sm.appendCustomEntry("other-extension", { ignored: true });
    sm.appendCustomEntry("opencandle-workflow", { workflow: "portfolio_builder" });

    const entries = drainOpenCandleCustomEntries(sm);

    expect(entries.map((entry) => entry.customType)).toEqual([
      "opencandle-router",
      "opencandle-workflow",
    ]);
    expect(entries[0]?.data).toEqual({ output: { route: "workflow" } });
  });

  it("flattens AgentTrace into the EvalTrace shape used by scorers", () => {
    const agentTrace: AgentTrace = {
      prompt: "Compare AAPL and MSFT",
      turns: [
        {
          text: "First pass.",
          toolCalls: [
            {
              name: "get_stock_quote",
              args: { symbol: "AAPL" },
              result: { symbol: "AAPL" },
              isError: false,
              durationMs: 12,
            },
          ],
        },
        {
          text: "Final pass.",
          toolCalls: [
            {
              name: "get_stock_quote",
              args: { symbol: "MSFT" },
              result: { symbol: "MSFT" },
              isError: false,
              durationMs: 8,
            },
          ],
        },
      ],
      interactions: [
        {
          question: "Which metric matters most?",
          method: "text",
          answer: "growth",
        },
      ],
      finalText: "Final pass.",
      toolSequence: ["get_stock_quote", "get_stock_quote"],
      durationMs: 20,
      customEntries: [
        {
          customType: "opencandle-router",
          timestamp: "2026-05-16T00:00:00.000Z",
          data: {
            output: {
              route: "workflow",
              workflow: "compare_assets",
              entities: { symbols: ["AAPL", "MSFT"] },
              confidence: "high",
            },
          },
        },
      ],
    };

    const trace = toEvalTrace(agentTrace);

    expect(trace.classification).toMatchObject({
      workflow: "compare_assets",
      tier: "llm",
      entities: { symbols: ["AAPL", "MSFT"] },
    });
    expect(trace.toolCalls.map((tool) => tool.name)).toEqual([
      "get_stock_quote",
      "get_stock_quote",
    ]);
    expect(trace.askUserTranscript).toEqual([
      { question: "Which metric matters most?", answer: "growth" },
    ]);
    expect(trace.text).toBe("Final pass.");
    expect(trace.customEntries).toHaveLength(1);
  });
});

describe("runOpenCandleSession", () => {
  const originalHome = process.env.OPENCANDLE_HOME;

  beforeEach(() => {
    createOpenCandleSessionMock.mockReset();
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalHome;
    }
  });

  it("passes explicit auth and model registry into the isolated harness session", async () => {
    const listeners: Array<(event: { type: string }) => void> = [];
    const session = {
      subscribe: vi.fn((listener: (event: { type: string }) => void) => {
        listeners.push(listener);
        return () => {};
      }),
      prompt: vi.fn(async () => {
        queueMicrotask(() => {
          for (const listener of listeners) listener({ type: "agent_end" });
        });
      }),
      dispose: vi.fn(),
      sessionManager: {
        getEntries: () => [],
      },
    };
    createOpenCandleSessionMock.mockResolvedValue({ session });

    const { modelRuntime } = await createTestModelRuntime({
      google: { type: "api_key", key: "test-key" },
    });

    await runOpenCandleSession({
      prompt: "What is AAPL trading at?",
      modelRuntime,
      defaultProvider: "google",
      defaultModel: "gemini-2.5-flash",
      settleGraceMs: 0,
      timeoutMs: 1000,
    });

    const options = createOpenCandleSessionMock.mock.calls[0]?.[0];
    expect(options.modelRuntime).toBe(modelRuntime);
    expect(options.useInlineExtension).toBe(true);
    expect(options.settingsManager.getDefaultProvider()).toBe("google");
    expect(options.settingsManager.getDefaultModel()).toBe("gemini-2.5-flash");
    expect(process.env.OPENCANDLE_HOME).toBe(originalHome);
  });

  it("passes an imported Pi session manager through for cross-surface continuation", async () => {
    const importedSessionManager = SessionManager.inMemory("/tmp/imported-hosted-session");
    const listeners: Array<(event: { type: string }) => void> = [];
    const session = {
      subscribe: vi.fn((listener: (event: { type: string }) => void) => {
        listeners.push(listener);
        return () => {};
      }),
      prompt: vi.fn(async () => {
        queueMicrotask(() => {
          for (const listener of listeners) listener({ type: "agent_end" });
        });
      }),
      dispose: vi.fn(),
      sessionManager: importedSessionManager,
    };
    createOpenCandleSessionMock.mockResolvedValue({ session });

    await runOpenCandleSession({
      prompt: "Continue this hosted session",
      sessionManager: importedSessionManager,
      settleGraceMs: 0,
      timeoutMs: 1000,
    });

    expect(createOpenCandleSessionMock.mock.calls[0]?.[0].sessionManager).toBe(
      importedSessionManager,
    );
  });

  it("keeps single prompt traces in the original one-prompt shape", async () => {
    const listeners: Array<(event: Record<string, unknown>) => void> = [];
    const session = {
      subscribe: vi.fn((listener: (event: Record<string, unknown>) => void) => {
        listeners.push(listener);
        return () => {};
      }),
      prompt: vi.fn(async () => {
        queueMicrotask(() => {
          for (const listener of listeners) {
            listener({
              type: "message_update",
              assistantMessageEvent: { type: "text_delta", delta: "done" },
            });
            listener({ type: "turn_end", message: {}, toolResults: [] });
            listener({ type: "agent_end", messages: [] });
          }
        });
      }),
      dispose: vi.fn(),
      sessionManager: {
        getEntries: () => [
          {
            type: "custom",
            customType: "opencandle-router",
            data: { output: { workflow: "general_qa" } },
            timestamp: "2026-07-04T00:00:00.000Z",
          },
        ],
      },
    };
    createOpenCandleSessionMock.mockResolvedValue({ session });

    const result = await runOpenCandleSession({
      prompt: "Answer briefly",
      settleGraceMs: 0,
      timeoutMs: 1000,
    });

    expect(result.agentTrace.prompt).toBe("Answer briefly");
    expect(result.agentTrace.prompts).toBeUndefined();
    expect(result.agentTrace.turns[0]?.promptIndex).toBeUndefined();
    expect(result.agentTrace.customEntries?.[0]?.promptIndex).toBeUndefined();
  });

  it("runs multiple prompts sequentially and tags trace entries by prompt index", async () => {
    const listeners: Array<(event: Record<string, unknown>) => void> = [];
    const entries: Array<Record<string, unknown>> = [];
    const session = {
      subscribe: vi.fn((listener: (event: Record<string, unknown>) => void) => {
        listeners.push(listener);
        return () => {};
      }),
      prompt: vi.fn(async (prompt: string) => {
        const promptIndex = session.prompt.mock.calls.length - 1;
        entries.push({
          type: "custom",
          customType: "opencandle-router",
          data: { prompt },
          timestamp: `2026-07-04T00:00:0${promptIndex}.000Z`,
        });
        queueMicrotask(() => {
          for (const listener of listeners) {
            listener({
              type: "tool_execution_start",
              toolCallId: `tool-${promptIndex}`,
              toolName: "get_stock_quote",
              args: { symbol: promptIndex === 0 ? "NVDA" : "AMD" },
            });
            listener({
              type: "tool_execution_end",
              toolCallId: `tool-${promptIndex}`,
              toolName: "get_stock_quote",
              result: { promptIndex },
              isError: false,
            });
            listener({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                delta: `answer ${promptIndex}`,
              },
            });
            listener({ type: "turn_end", message: {}, toolResults: [] });
            listener({ type: "agent_end", messages: [] });
          }
        });
      }),
      dispose: vi.fn(),
      sessionManager: {
        getEntries: () => entries,
      },
    };
    createOpenCandleSessionMock.mockResolvedValue({ session });

    const result = await runOpenCandleSession({
      prompts: ["Tell me about NVDA", "Now compare AMD"],
      settleGraceMs: 0,
      timeoutMs: 1000,
    });

    expect(session.prompt).toHaveBeenCalledTimes(2);
    expect(session.prompt.mock.calls.map((call) => call[0])).toEqual([
      "Tell me about NVDA",
      "Now compare AMD",
    ]);
    expect(result.agentTrace.prompt).toBe("Tell me about NVDA");
    expect(result.agentTrace.prompts).toEqual(["Tell me about NVDA", "Now compare AMD"]);
    expect(result.agentTrace.turns.map((turn) => turn.promptIndex)).toEqual([0, 1]);
    expect(result.agentTrace.turns.map((turn) => turn.toolCalls[0]?.promptIndex)).toEqual([0, 1]);
    expect(result.agentTrace.customEntries?.map((entry) => entry.promptIndex)).toEqual([0, 1]);
    expect(result.evalTrace.customEntries?.map((entry) => entry.promptIndex)).toEqual([0, 1]);
  });
});
