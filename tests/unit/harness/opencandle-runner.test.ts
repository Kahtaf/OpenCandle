import { AuthStorage, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  drainOpenCandleCustomEntries,
  runOpenCandleSession,
  toEvalTrace,
} from "../../harness/opencandle-runner.js";
import type { AgentTrace } from "../../harness/types.js";

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

    const authStorage = AuthStorage.inMemory({
      google: { type: "api_key", key: "test-key" },
    });
    const modelRegistry = ModelRegistry.inMemory(authStorage);

    await runOpenCandleSession({
      prompt: "What is AAPL trading at?",
      authStorage,
      modelRegistry,
      defaultProvider: "google",
      defaultModel: "gemini-2.5-flash",
      settleGraceMs: 0,
      timeoutMs: 1000,
    });

    const options = createOpenCandleSessionMock.mock.calls[0]?.[0];
    expect(options.authStorage).toBe(authStorage);
    expect(options.modelRegistry).toBe(modelRegistry);
    expect(options.useInlineExtension).toBe(true);
    expect(options.settingsManager.getDefaultProvider()).toBe("google");
    expect(options.settingsManager.getDefaultModel()).toBe("gemini-2.5-flash");
    expect(process.env.OPENCANDLE_HOME).toBe(originalHome);
  });
});
