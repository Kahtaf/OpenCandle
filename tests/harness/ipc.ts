/**
 * File-based IPC channel for the agent test harness.
 * The harness process writes questions and traces; the driving agent writes answers.
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTrace } from "./types.js";

export interface Question {
  question: string;
  questionType: "select" | "text" | "confirm";
  options?: string[];
  placeholder?: string;
  reason?: string;
}

export interface PromptRequest {
  prompt: string;
}

export class IpcChannel {
  constructor(private dir: string) {}

  // --- Harness side ---

  /** Write question.json and set status=waiting. */
  writeQuestion(q: Question): void {
    const tmp = join(this.dir, "question.json.tmp");
    writeFileSync(tmp, JSON.stringify(q, null, 2), "utf-8");
    const target = join(this.dir, "question.json");
    // Atomic rename isn't available in Node without fs.renameSync, use it
    renameSync(tmp, target);
    this.setStatus("waiting");
  }

  /** Poll for answer.json. Cleans up question + answer files after reading. */
  async pollForAnswer(timeoutMs = 300_000): Promise<{ value: string } | null> {
    const answerPath = join(this.dir, "answer.json");
    const questionPath = join(this.dir, "question.json");

    const result = await new Promise<{ value: string } | null>((resolve) => {
      const start = Date.now();

      const check = () => {
        if (existsSync(answerPath)) {
          cleanup();
          const raw = readFileSync(answerPath, "utf-8");
          resolve(JSON.parse(raw) as { value: string });
          return true;
        }
        if (existsSync(join(this.dir, "prompt-request.json"))) {
          cleanup();
          resolve(null);
          return true;
        }
        return false;
      };

      const cleanup = () => {
        if (timer) {
          clearInterval(timer);
        }
      };

      const timer = setInterval(() => {
        if (check()) return;
        if (Date.now() - start > timeoutMs) {
          cleanup();
          resolve(null);
        }
      }, 100);

      // Check immediately
      check();
    });

    // Clean up IPC files
    rmSync(answerPath, { force: true });
    rmSync(questionPath, { force: true });

    return result;
  }

  /** Write trace.json atomically and set status=done. */
  writeTrace(trace: AgentTrace): void {
    // tmp+rename like every other IPC write: a follow-up prompt rewrites
    // trace.json, and a concurrent `trace` CLI read of a truncated file
    // throws "Unexpected end of JSON input".
    const tmp = join(this.dir, "trace.json.tmp");
    writeFileSync(tmp, JSON.stringify(trace, null, 2), "utf-8");
    renameSync(tmp, join(this.dir, "trace.json"));
    this.setStatus("done");
  }

  /** Consume a pending follow-up prompt request, if one exists. */
  readPromptRequest(): PromptRequest | null {
    const p = join(this.dir, "prompt-request.json");
    if (!existsSync(p)) return null;
    const request = JSON.parse(readFileSync(p, "utf-8")) as PromptRequest;
    rmSync(p, { force: true });
    return request;
  }

  /** Write error.txt and set status=error. */
  writeError(message: string): void {
    writeFileSync(join(this.dir, "error.txt"), message, "utf-8");
    this.setStatus("error");
  }

  /** Atomic status file write. */
  setStatus(status: string): void {
    const tmp = join(this.dir, "status.tmp");
    writeFileSync(tmp, status, "utf-8");
    renameSync(tmp, join(this.dir, "status"));
  }

  /** Write PID file for liveness detection. */
  writePid(): void {
    writeFileSync(join(this.dir, "pid"), String(process.pid), "utf-8");
  }

  // --- CLI side (static helpers) ---

  static readStatus(dir: string): string | null {
    const p = join(dir, "status");
    return existsSync(p) ? readFileSync(p, "utf-8").trim() : null;
  }

  static readQuestion(dir: string): Question | null {
    const p = join(dir, "question.json");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8")) as Question;
  }

  static writeAnswer(dir: string, value: string): void {
    const tmp = join(dir, "answer.json.tmp");
    writeFileSync(tmp, JSON.stringify({ value }), "utf-8");
    renameSync(tmp, join(dir, "answer.json"));
  }

  static writePromptRequest(dir: string, prompt: string): void {
    const tmp = join(dir, "prompt-request.json.tmp");
    writeFileSync(tmp, JSON.stringify({ prompt }, null, 2), "utf-8");
    renameSync(tmp, join(dir, "prompt-request.json"));
    new IpcChannel(dir).setStatus("running");
  }

  static readTrace(dir: string): AgentTrace | null {
    const p = join(dir, "trace.json");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8")) as AgentTrace;
  }

  /** True when the run process that wrote the pid file is still alive. */
  static isRunAlive(dir: string): boolean {
    const p = join(dir, "pid");
    if (!existsSync(p)) return false;
    const pid = Number(readFileSync(p, "utf-8").trim());
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
