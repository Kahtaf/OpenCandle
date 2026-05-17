import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  drainOpenCandleCustomEntries,
  toEvalTrace,
} from "../../harness/opencandle-runner.js";
import type { AgentTrace } from "../../harness/types.js";

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
    expect(trace.text).toBe("First pass.Final pass.");
    expect(trace.customEntries).toHaveLength(1);
  });
});
