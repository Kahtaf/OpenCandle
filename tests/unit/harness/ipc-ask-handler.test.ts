import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IpcChannel } from "../../harness/ipc.js";
import { createTraceCollector } from "../../harness/trace-collector.js";
import { createIpcAskHandler } from "../../harness/ipc-ask-handler.js";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

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

describe("createIpcAskHandler", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ipc-handler-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes question, external agent answers, handler returns result", async () => {
    const ipc = new IpcChannel(dir);
    const session = createMockSession();
    const collector = createTraceCollector(session, "test");
    const handler = createIpcAskHandler(ipc, collector);

    // Simulate external agent answering after a short delay
    setTimeout(() => {
      const q = IpcChannel.readQuestion(dir);
      expect(q).not.toBeNull();
      expect(q!.question).toBe("Risk tolerance?");
      IpcChannel.writeAnswer(dir, "Moderate");
    }, 50);

    const result = await handler({
      question: "Risk tolerance?",
      questionType: "select",
      options: ["Low", "Moderate", "High"],
    });

    expect(result).toEqual({ answer: "Moderate", cancelled: false });
    expect(IpcChannel.readStatus(dir)).toBe("running");

    // Interaction recorded in trace
    const trace = collector.getTrace();
    expect(trace.interactions).toHaveLength(1);
    expect(trace.interactions[0].answer).toBe("Moderate");
    expect(trace.interactions[0].method).toBe("select");
    collector.dispose();
  });

  it("returns cancelled on timeout and records null answer", async () => {
    const ipc = new IpcChannel(dir);
    const session = createMockSession();
    const collector = createTraceCollector(session, "test");
    const handler = createIpcAskHandler(ipc, collector, 200);

    const result = await handler({
      question: "Waiting forever?",
      questionType: "text",
    });

    expect(result).toEqual({ answer: null, cancelled: true });

    const trace = collector.getTrace();
    expect(trace.interactions).toHaveLength(1);
    expect(trace.interactions[0].answer).toBeNull();
    collector.dispose();
  });
});
