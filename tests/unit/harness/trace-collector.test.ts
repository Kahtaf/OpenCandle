import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTraceCollector } from "../../harness/trace-collector.js";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

function createMockSession() {
  let listener: ((event: AgentSessionEvent) => void) | null = null;
  return {
    subscribe(cb: (event: AgentSessionEvent) => void) {
      listener = cb;
      return () => { listener = null; };
    },
    emit(event: AgentSessionEvent) {
      listener?.(event);
    },
  };
}

describe("createTraceCollector", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "trace-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("captures tool calls across a single turn", () => {
    const session = createMockSession();
    const collector = createTraceCollector(session, "test prompt");

    session.emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "get_stock_quote", args: { symbol: "AAPL" } });
    session.emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "get_stock_quote", result: { price: 150 }, isError: false });
    session.emit({ type: "turn_end", message: {} as any, toolResults: [] });
    session.emit({ type: "agent_end", messages: [] });

    const trace = collector.getTrace();
    expect(trace.prompt).toBe("test prompt");
    expect(trace.turns).toHaveLength(1);
    expect(trace.turns[0].toolCalls).toHaveLength(1);
    expect(trace.turns[0].toolCalls[0].name).toBe("get_stock_quote");
    expect(trace.turns[0].toolCalls[0].args).toEqual({ symbol: "AAPL" });
    expect(trace.turns[0].toolCalls[0].result).toEqual({ price: 150 });
    expect(trace.turns[0].toolCalls[0].isError).toBe(false);
    expect(trace.turns[0].toolCalls[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(trace.toolSequence).toEqual(["get_stock_quote"]);
    collector.dispose();
  });

  it("accumulates text deltas", () => {
    const session = createMockSession();
    const collector = createTraceCollector(session, "test");

    session.emit({ type: "message_update", message: {} as any, assistantMessageEvent: { type: "text_delta", delta: "Hello " } });
    session.emit({ type: "message_update", message: {} as any, assistantMessageEvent: { type: "text_delta", delta: "world" } });
    session.emit({ type: "turn_end", message: {} as any, toolResults: [] });
    session.emit({ type: "agent_end", messages: [] });

    const trace = collector.getTrace();
    expect(trace.turns[0].text).toBe("Hello world");
    expect(trace.finalText).toBe("Hello world");
    collector.dispose();
  });

  it("captures multiple turns", () => {
    const session = createMockSession();
    const collector = createTraceCollector(session, "multi-turn");

    session.emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "tool_a", args: {} });
    session.emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "tool_a", result: "ok", isError: false });
    session.emit({ type: "turn_end", message: {} as any, toolResults: [] });

    session.emit({ type: "tool_execution_start", toolCallId: "t2", toolName: "tool_b", args: {} });
    session.emit({ type: "tool_execution_end", toolCallId: "t2", toolName: "tool_b", result: "ok", isError: false });
    session.emit({ type: "message_update", message: {} as any, assistantMessageEvent: { type: "text_delta", delta: "done" } });
    session.emit({ type: "turn_end", message: {} as any, toolResults: [] });
    session.emit({ type: "agent_end", messages: [] });

    const trace = collector.getTrace();
    expect(trace.turns).toHaveLength(2);
    expect(trace.toolSequence).toEqual(["tool_a", "tool_b"]);
    expect(trace.turns[1].text).toBe("done");
    collector.dispose();
  });

  it("tracks interactions via addInteraction", () => {
    const session = createMockSession();
    const collector = createTraceCollector(session, "interactive");

    collector.addInteraction({ question: "Risk?", method: "select", options: ["Low", "High"], answer: "Low" });
    session.emit({ type: "agent_end", messages: [] });

    const trace = collector.getTrace();
    expect(trace.interactions).toHaveLength(1);
    expect(trace.interactions[0]).toEqual({ question: "Risk?", method: "select", options: ["Low", "High"], answer: "Low" });
    collector.dispose();
  });

  it("captures error tool calls", () => {
    const session = createMockSession();
    const collector = createTraceCollector(session, "error test");

    session.emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "bad_tool", args: {} });
    session.emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "bad_tool", result: "fail", isError: true });
    session.emit({ type: "turn_end", message: {} as any, toolResults: [] });
    session.emit({ type: "agent_end", messages: [] });

    const trace = collector.getTrace();
    expect(trace.turns[0].toolCalls[0].isError).toBe(true);
    collector.dispose();
  });

  it("writes events to JSONL file", () => {
    const session = createMockSession();
    const jsonlPath = join(tmpDir, "events.jsonl");
    const collector = createTraceCollector(session, "jsonl test", { jsonlPath });

    session.emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "my_tool", args: { x: 1 } });
    session.emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "my_tool", result: "ok", isError: false });
    session.emit({ type: "turn_end", message: {} as any, toolResults: [] });
    session.emit({ type: "agent_end", messages: [] });

    const lines = readFileSync(jsonlPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(4);

    const first = JSON.parse(lines[0]);
    expect(first.type).toBe("tool_execution_start");
    expect(first.toolName).toBe("my_tool");
    expect(first.timestamp).toBeGreaterThan(0);
    collector.dispose();
  });

  it("handles empty session gracefully", () => {
    const session = createMockSession();
    const collector = createTraceCollector(session, "empty");

    session.emit({ type: "agent_end", messages: [] });

    const trace = collector.getTrace();
    expect(trace.turns).toHaveLength(0);
    expect(trace.toolSequence).toEqual([]);
    expect(trace.finalText).toBe("");
    collector.dispose();
  });
});
