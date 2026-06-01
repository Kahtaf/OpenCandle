import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { invokeToolFromUi } from "../../../gui/server/invoke-tool.js";

describe("invokeToolFromUi", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;

  beforeEach(() => {
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-gui-invoke-tool-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
  });

  afterEach(() => {
    if (originalEnv == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalEnv;
    }
    rmSync(openCandleHome, { recursive: true, force: true });
  });

  it("appends normalized market-state mutation metadata for UI tool results", async () => {
    const messages: Message[] = [];
    const sessionManager = {
      appendMessage(message: Message) {
        messages.push(message);
      },
    } as unknown as SessionManager;
    const params = Type.Object({
      action: Type.String(),
      symbol: Type.String(),
    });
    const tool: AgentTool<typeof params> = {
      name: "manage_watchlist",
      label: "Watchlist",
      description: "test",
      parameters: params,
      async execute() {
        return {
          content: [{ type: "text", text: "Added AAPL" }],
          details: {
            id: 7,
            instrumentId: 3,
            symbol: "AAPL",
          },
        };
      },
    };

    await invokeToolFromUi(sessionManager, tool, { action: "add", symbol: "AAPL" }, "ui");

    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: "toolResult",
      toolName: "manage_watchlist",
      details: {
        source: "ui",
        args: { action: "add", symbol: "AAPL" },
        value: { id: 7, instrumentId: 3, symbol: "AAPL" },
        stateChange: {
          source: "ui",
          domain: "watchlist",
          action: "add",
          targetType: "watchlist_item",
          targetId: 7,
          instrumentId: 3,
          toolName: "manage_watchlist",
        },
      },
    });
  });

  it("includes target ids for market-state removals that affect multiple rows", async () => {
    const messages: Message[] = [];
    const sessionManager = {
      appendMessage(message: Message) {
        messages.push(message);
      },
    } as unknown as SessionManager;
    const params = Type.Object({
      action: Type.String(),
      symbol: Type.String(),
    });
    const tool: AgentTool<typeof params> = {
      name: "track_portfolio",
      label: "Portfolio",
      description: "test",
      parameters: params,
      async execute() {
        return {
          content: [{ type: "text", text: "Removed VTI" }],
          details: {
            symbol: "VTI",
            removedCount: 2,
            removedLotIds: [4, 5],
            instrumentIds: [9],
          },
        };
      },
    };

    await invokeToolFromUi(sessionManager, tool, { action: "remove", symbol: "VTI" }, "ui");

    expect(messages[1]).toMatchObject({
      role: "toolResult",
      toolName: "track_portfolio",
      details: {
        stateChange: {
          source: "ui",
          domain: "portfolio",
          action: "remove",
          targetType: "portfolio_lot",
          targetIds: [4, 5],
          instrumentIds: [9],
          toolName: "track_portfolio",
        },
      },
    });
  });
});
