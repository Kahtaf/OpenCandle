import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToolInvokeController, invokeToolFromUi } from "../../../gui/server/invoke-tool.js";
import { acquireWriterLock, writerLockScopeForSession } from "../../../gui/server/writer-lock.js";
import { recordPendingSessionAction } from "../../../src/pi/session-action-dedupe.js";

describe("local session coordinator owner-recovery retry pinning", () => {
  const originalFetch = globalThis.fetch;
  let openCandleHome: string;

  beforeEach(() => {
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-coordinator-recovery-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.OPENCANDLE_HOME;
    rmSync(openCandleHome, { recursive: true, force: true });
  });

  it("surfaces a retryable syncing error instead of auto-resubmitting an unknown owner action", async () => {
    const currentSessionManager = sessionManager(
      "current-session",
      join(openCandleHome, "current.jsonl"),
    );
    const targetSessionManager = sessionManager(
      "target-session",
      join(openCandleHome, "target.jsonl"),
    );
    const actionId = "tool-action-owner-recovery";
    await acquireWriterLock(writerLockScopeForSession(targetSessionManager), "gui", {
      pid: 999_999,
      coordinatorEndpoint: "http://127.0.0.1:25432",
      coordinatorSecret: "secret",
    });
    recordPendingSessionAction(targetSessionManager, actionId);
    globalThis.fetch = vi.fn(async () => {
      throw new Error("owner process exited before acknowledgement");
    }) as typeof fetch;

    const tool = quoteTool();
    const invokeTool = vi.fn(invokeToolFromUi);
    const controller = createToolInvokeController({
      role: "follower",
      getSessionManager: () => currentSessionManager,
      broadcastState: vi.fn(),
      getTools: () => [tool],
      resolveSessionManager: async () => targetSessionManager,
      invokeTool,
    });

    await expect(
      controller.handleToolInvoke("get_stock_quote", { symbol: "AAPL" }, "target-session", {
        actionId,
      }),
    ).rejects.toThrow("OpenCandle is reconnecting to this session.");
    expect(invokeTool).not.toHaveBeenCalled();
  });
});

function sessionManager(sessionId: string, sessionFile: string): SessionManager {
  return {
    getSessionId: () => sessionId,
    getSessionFile: () => sessionFile,
    appendMessage: vi.fn(),
  } as unknown as SessionManager;
}

function quoteTool(): AgentTool<ReturnType<typeof Type.Object>> {
  const params = Type.Object({
    symbol: Type.String(),
  });
  return {
    name: "get_stock_quote",
    label: "Quote",
    description: "test",
    parameters: params,
    async execute() {
      return {
        content: [{ type: "text", text: "AAPL quote" }],
        details: { symbol: "AAPL", price: 190 },
      };
    },
  };
}
