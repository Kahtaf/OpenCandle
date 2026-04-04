/**
 * Integration tests for the full harness flow:
 * trace collector + IPC + ask handler working together.
 * Uses synthetic session events (no LLM needed).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import { IpcChannel } from "../../harness/ipc.js";
import { createTraceCollector } from "../../harness/trace-collector.js";
import { createIpcAskHandler } from "../../harness/ipc-ask-handler.js";

function createMockSession() {
  let listener: ((event: AgentSessionEvent) => void) | null = null;
  return {
    subscribe(cb: (event: AgentSessionEvent) => void) {
      listener = cb;
      return () => { listener = null; };
    },
    emit(event: AgentSessionEvent) { listener?.(event); },
  };
}

describe("harness integration", () => {
  let ipcDir: string;

  beforeEach(() => {
    ipcDir = mkdtempSync(join(tmpdir(), "harness-int-"));
  });

  afterEach(() => {
    rmSync(ipcDir, { recursive: true, force: true });
  });

  it("simple prompt: runs to completion with tool calls and text in trace", () => {
    const session = createMockSession();
    const ipc = new IpcChannel(ipcDir);
    ipc.setStatus("running");

    const collector = createTraceCollector(session, "What is AAPL price?", {
      jsonlPath: join(ipcDir, "events.jsonl"),
    });

    // Simulate: tool call → text response → end
    session.emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "get_stock_quote", args: { symbol: "AAPL" } });
    session.emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "get_stock_quote", result: { price: 248.5 }, isError: false });
    session.emit({ type: "message_update", message: {} as any, assistantMessageEvent: { type: "text_delta", delta: "AAPL is trading at $248.50" } });
    session.emit({ type: "turn_end", message: {} as any, toolResults: [] });
    session.emit({ type: "agent_end", messages: [] });

    const trace = collector.getTrace();
    ipc.writeTrace(trace);

    // Verify trace.json
    const written = IpcChannel.readTrace(ipcDir)!;
    expect(written.prompt).toBe("What is AAPL price?");
    expect(written.turns).toHaveLength(1);
    expect(written.turns[0].toolCalls[0].name).toBe("get_stock_quote");
    expect(written.turns[0].toolCalls[0].result).toEqual({ price: 248.5 });
    expect(written.turns[0].text).toContain("AAPL");
    expect(written.toolSequence).toEqual(["get_stock_quote"]);
    expect(written.finalText).toContain("248.50");
    expect(IpcChannel.readStatus(ipcDir)).toBe("done");

    collector.dispose();
  });

  it("ask_user round-trip: pauses, answer provided, continues, trace includes interaction", async () => {
    const session = createMockSession();
    const ipc = new IpcChannel(ipcDir);
    ipc.setStatus("running");

    const collector = createTraceCollector(session, "Build me a portfolio");
    const handler = createIpcAskHandler(ipc, collector);

    // Simulate first tool call
    session.emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "get_stock_quote", args: { symbol: "SPY" } });
    session.emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "get_stock_quote", result: { price: 500 }, isError: false });

    // Simulate ask_user — external agent writes answer after delay
    setTimeout(() => {
      expect(IpcChannel.readStatus(ipcDir)).toBe("waiting");
      const q = IpcChannel.readQuestion(ipcDir);
      expect(q!.question).toBe("What is your risk tolerance?");
      IpcChannel.writeAnswer(ipcDir, "Moderate");
    }, 50);

    const result = await handler({
      question: "What is your risk tolerance?",
      questionType: "select",
      options: ["Conservative", "Moderate", "Aggressive"],
    });

    expect(result).toEqual({ answer: "Moderate", cancelled: false });

    // Continue with more tool calls after answer
    session.emit({ type: "tool_execution_start", toolCallId: "t2", toolName: "get_stock_quote", args: { symbol: "AAPL" } });
    session.emit({ type: "tool_execution_end", toolCallId: "t2", toolName: "get_stock_quote", result: { price: 248 }, isError: false });
    session.emit({ type: "message_update", message: {} as any, assistantMessageEvent: { type: "text_delta", delta: "Here is your portfolio" } });
    session.emit({ type: "turn_end", message: {} as any, toolResults: [] });
    session.emit({ type: "agent_end", messages: [] });

    const trace = collector.getTrace();
    ipc.writeTrace(trace);

    const written = IpcChannel.readTrace(ipcDir)!;
    expect(written.interactions).toHaveLength(1);
    expect(written.interactions[0]).toEqual({
      question: "What is your risk tolerance?",
      method: "select",
      options: ["Conservative", "Moderate", "Aggressive"],
      answer: "Moderate",
    });
    expect(written.toolSequence).toEqual(["get_stock_quote", "get_stock_quote"]);

    collector.dispose();
  });

  it("multi-step workflow: multiple question/answer rounds", async () => {
    const session = createMockSession();
    const ipc = new IpcChannel(ipcDir);
    const collector = createTraceCollector(session, "Portfolio builder");
    const handler = createIpcAskHandler(ipc, collector);

    // Round 1
    setTimeout(() => IpcChannel.writeAnswer(ipcDir, "Growth"), 30);
    const r1 = await handler({ question: "Investment goal?", questionType: "select", options: ["Growth", "Income"] });
    expect(r1.answer).toBe("Growth");

    // Round 2
    setTimeout(() => IpcChannel.writeAnswer(ipcDir, "High"), 30);
    const r2 = await handler({ question: "Risk level?", questionType: "select", options: ["Low", "High"] });
    expect(r2.answer).toBe("High");

    // Round 3
    setTimeout(() => IpcChannel.writeAnswer(ipcDir, "10000"), 30);
    const r3 = await handler({ question: "How much to invest?", questionType: "text" });
    expect(r3.answer).toBe("10000");

    session.emit({ type: "agent_end", messages: [] });

    const trace = collector.getTrace();
    expect(trace.interactions).toHaveLength(3);
    expect(trace.interactions.map((i) => i.answer)).toEqual(["Growth", "High", "10000"]);

    collector.dispose();
  });

  it("timeout on answer: handler returns cancelled", async () => {
    const session = createMockSession();
    const ipc = new IpcChannel(ipcDir);
    const collector = createTraceCollector(session, "timeout test");
    const handler = createIpcAskHandler(ipc, collector, 200);

    const result = await handler({ question: "Hello?", questionType: "text" });

    expect(result).toEqual({ answer: null, cancelled: true });
    expect(collector.getTrace().interactions[0].answer).toBeNull();

    collector.dispose();
  });

  it("events.jsonl is written continuously during the run", () => {
    const session = createMockSession();
    const jsonlPath = join(ipcDir, "events.jsonl");
    const collector = createTraceCollector(session, "streaming test", { jsonlPath });

    // First tool call
    session.emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "tool_a", args: {} });
    const afterFirst = readFileSync(jsonlPath, "utf-8").trim().split("\n");
    expect(afterFirst).toHaveLength(1);

    // Second event
    session.emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "tool_a", result: "ok", isError: false });
    const afterSecond = readFileSync(jsonlPath, "utf-8").trim().split("\n");
    expect(afterSecond).toHaveLength(2);

    // Turn end
    session.emit({ type: "turn_end", message: {} as any, toolResults: [] });
    const afterTurn = readFileSync(jsonlPath, "utf-8").trim().split("\n");
    expect(afterTurn).toHaveLength(3);

    // Agent end
    session.emit({ type: "agent_end", messages: [] });
    const afterEnd = readFileSync(jsonlPath, "utf-8").trim().split("\n");
    expect(afterEnd).toHaveLength(4);

    // Each line is valid JSON
    for (const line of afterEnd) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    collector.dispose();
  });
});
