import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IpcChannel } from "../../harness/ipc.js";
import type { AgentTrace } from "../../harness/types.js";

describe("IpcChannel", () => {
  let dir: string;
  let ipc: IpcChannel;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ipc-test-"));
    ipc = new IpcChannel(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("setStatus writes status file atomically", () => {
    ipc.setStatus("running");
    expect(IpcChannel.readStatus(dir)).toBe("running");

    ipc.setStatus("waiting");
    expect(IpcChannel.readStatus(dir)).toBe("waiting");
  });

  it("writeQuestion writes question.json and sets status=waiting", () => {
    const q = {
      question: "Risk tolerance?",
      questionType: "select" as const,
      options: ["Low", "High"],
    };
    ipc.writeQuestion(q);

    expect(IpcChannel.readStatus(dir)).toBe("waiting");
    const read = IpcChannel.readQuestion(dir);
    expect(read).toEqual(q);
  });

  it("full cycle: write question → write answer → poll returns answer", async () => {
    const q = { question: "Pick one", questionType: "select" as const, options: ["A", "B"] };
    ipc.writeQuestion(q);

    // Simulate external agent writing the answer after a short delay
    setTimeout(() => {
      IpcChannel.writeAnswer(dir, "A");
    }, 50);

    const answer = await ipc.pollForAnswer(5_000);
    expect(answer).toEqual({ value: "A" });

    // Files cleaned up after poll
    expect(existsSync(join(dir, "answer.json"))).toBe(false);
    expect(existsSync(join(dir, "question.json"))).toBe(false);
  });

  it("pollForAnswer returns null on timeout", async () => {
    ipc.writeQuestion({ question: "Waiting?", questionType: "text" as const });

    const answer = await ipc.pollForAnswer(200);
    expect(answer).toBeNull();
  });

  it("writeTrace writes trace.json and sets status=done", () => {
    const trace: AgentTrace = {
      prompt: "test",
      turns: [],
      interactions: [],
      finalText: "done",
      toolSequence: [],
      durationMs: 100,
    };
    ipc.writeTrace(trace);

    expect(IpcChannel.readStatus(dir)).toBe("done");
    const read = IpcChannel.readTrace(dir);
    expect(read).toEqual(trace);
  });

  it("writePromptRequest moves a completed session back to running for send", () => {
    ipc.setStatus("done");

    IpcChannel.writePromptRequest(dir, "What about AMD?");

    expect(IpcChannel.readStatus(dir)).toBe("running");
    expect(ipc.readPromptRequest()).toEqual({ prompt: "What about AMD?" });
    expect(ipc.readPromptRequest()).toBeNull();
  });

  it("writeTrace leaves no partial tmp file behind", () => {
    const trace: AgentTrace = {
      prompt: "test",
      turns: [],
      interactions: [],
      finalText: "done",
      toolSequence: [],
      durationMs: 100,
    };
    ipc.writeTrace(trace);

    // Atomic tmp+rename write: readers polling trace.json must never observe
    // a truncated file during a follow-up prompt's rewrite.
    expect(existsSync(join(dir, "trace.json.tmp"))).toBe(false);
    expect(IpcChannel.readTrace(dir)).toEqual(trace);
  });

  it("isRunAlive reflects the pid file's process liveness", () => {
    expect(IpcChannel.isRunAlive(dir)).toBe(false);

    ipc.writePid();
    expect(IpcChannel.isRunAlive(dir)).toBe(true);
  });

  it("isRunAlive is false for a dead pid", () => {
    // PID beyond the OS pid range cannot be a live process.
    writeFileSync(join(dir, "pid"), "999999999", "utf-8");
    expect(IpcChannel.isRunAlive(dir)).toBe(false);
  });

  it("writeError writes error.txt and sets status=error", () => {
    ipc.writeError("something broke");

    expect(IpcChannel.readStatus(dir)).toBe("error");
    expect(readFileSync(join(dir, "error.txt"), "utf-8")).toBe("something broke");
  });

  it("writePid writes the current PID", () => {
    ipc.writePid();
    const pid = readFileSync(join(dir, "pid"), "utf-8");
    expect(Number(pid)).toBe(process.pid);
  });

  it("static helpers return null for missing files", () => {
    expect(IpcChannel.readStatus(dir)).toBeNull();
    expect(IpcChannel.readQuestion(dir)).toBeNull();
    expect(IpcChannel.readTrace(dir)).toBeNull();
  });
});
