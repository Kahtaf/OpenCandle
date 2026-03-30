import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { LogEvent, LogEventType } from "./types.js";

interface LogInput {
  type: LogEventType;
  payload: unknown;
}

export class ChatLogger {
  private readonly logPath: string;
  private initialized = false;

  constructor(
    private readonly baseDir: string,
    private readonly sessionId: string,
  ) {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    this.logPath = join(baseDir, year, month, day, `${sessionId}.jsonl`);
  }

  getLogPath(): string {
    return this.logPath;
  }

  log(input: LogInput): void {
    if (!this.initialized) {
      const dir = join(this.logPath, "..");
      mkdirSync(dir, { recursive: true });
      this.initialized = true;
    }

    const event: LogEvent = {
      type: input.type,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      payload: input.payload,
    };

    appendFileSync(this.logPath, JSON.stringify(event) + "\n", "utf-8");
  }
}
