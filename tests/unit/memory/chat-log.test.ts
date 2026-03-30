import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChatLogger, createDefaultChatLogger } from "../../../src/memory/chat-log.js";
import type { LogEvent } from "../../../src/memory/types.js";

describe("ChatLogger", () => {
  let tempDir: string;
  let logger: ChatLogger;
  const sessionId = "test-session-123";
  const originalVantageHome = process.env.VANTAGE_HOME;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vantage-log-test-"));
    logger = new ChatLogger(tempDir, sessionId);
  });

  afterEach(() => {
    if (originalVantageHome == null) {
      delete process.env.VANTAGE_HOME;
    } else {
      process.env.VANTAGE_HOME = originalVantageHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates log directory structure", () => {
    logger.log({ type: "session_start", payload: {} });
    const logPath = logger.getLogPath();
    expect(logPath).toContain(tempDir);
    expect(logPath).toMatch(/\.jsonl$/);
  });

  it("appends events as valid JSONL lines", () => {
    logger.log({ type: "session_start", payload: { cwd: "/test" } });
    logger.log({ type: "user_message", payload: { text: "hello" } });

    const content = readFileSync(logger.getLogPath(), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("each line parses as valid JSON with required fields", () => {
    logger.log({ type: "session_start", payload: { cwd: "/test" } });
    logger.log({ type: "user_message", payload: { text: "analyze NVDA" } });

    const content = readFileSync(logger.getLogPath(), "utf-8");
    const lines = content.trim().split("\n");

    for (const line of lines) {
      const event: LogEvent = JSON.parse(line);
      expect(event.type).toBeTruthy();
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(event.sessionId).toBe(sessionId);
      expect(event.payload).toBeDefined();
    }
  });

  it("preserves event type in output", () => {
    logger.log({ type: "tool_call_start", payload: { tool: "get_stock_quote", args: { symbol: "AAPL" } } });

    const content = readFileSync(logger.getLogPath(), "utf-8");
    const event: LogEvent = JSON.parse(content.trim());
    expect(event.type).toBe("tool_call_start");
  });

  it("preserves complex payloads", () => {
    const payload = {
      workflow_type: "portfolio_builder",
      resolved_slots: { budget: 10000, riskProfile: "balanced" },
      defaults_used: ["riskProfile", "timeHorizon"],
    };
    logger.log({ type: "slot_resolution", payload });

    const content = readFileSync(logger.getLogPath(), "utf-8");
    const event: LogEvent = JSON.parse(content.trim());
    expect(event.payload).toEqual(payload);
  });

  it("uses date-based directory structure", () => {
    logger.log({ type: "session_start", payload: {} });
    const logPath = logger.getLogPath();
    // Path should contain YYYY/MM/DD pattern
    expect(logPath).toMatch(/\d{4}\/\d{2}\/\d{2}\//);
  });

  it("includes session ID in filename", () => {
    logger.log({ type: "session_start", payload: {} });
    const logPath = logger.getLogPath();
    expect(logPath).toContain(sessionId);
  });

  it("builds the default logger under VANTAGE_HOME/logs", () => {
    process.env.VANTAGE_HOME = tempDir;

    const defaultLogger = createDefaultChatLogger(sessionId);

    expect(defaultLogger.getLogPath()).toContain(join(tempDir, "logs"));
  });
});
