import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@earendil-works/pi-agent-core";
import { SessionManager, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserOpenCandleExtensionHost } from "../../../gui/hosted/runtime/browser-extension-host.js";
import { resolveFirstClassModel } from "../../../src/pi/model-provider-catalog.js";
import { createSqlJsStateDatabase } from "../../../src/runtime/sqljs-state-database-node.js";

describe("BrowserOpenCandleExtensionHost", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("applies active tools and extension tool hooks to the bound Pi Agent", async () => {
    const root = mkdtempSync(join(tmpdir(), "opencandle-extension-host-"));
    roots.push(root);
    const database = await createSqlJsStateDatabase();
    const model = resolveFirstClassModel("openai", "gpt-4.1-mini");
    if (!model) throw new Error("Expected test model");
    const tools = [tool("first"), tool("second")];
    const host = new BrowserOpenCandleExtensionHost(
      SessionManager.create(root, join(root, "sessions")),
      model,
      { complete: vi.fn(async () => "") },
      database,
      tools,
    );
    const agent = {
      state: { tools: [] },
      signal: undefined,
      hasQueuedMessages: () => false,
      waitForIdle: vi.fn(),
      abort: vi.fn(),
    } as unknown as Agent;

    host.bindAgent(agent);
    host.api.setActiveTools(["second"]);
    expect(agent.state.tools.map((candidate) => candidate.name)).toEqual(["second"]);

    host.api.on("tool_call", async () => ({ block: true, reason: "blocked by test" }));
    await expect(
      agent.beforeToolCall?.({
        toolCall: { id: "call-1", name: "second", type: "toolCall", arguments: {} },
        args: {},
        assistantMessage: {} as never,
        context: {} as never,
      }),
    ).resolves.toEqual({ block: true, reason: "blocked by test" });
    database.close();
  });
});

function tool(name: string): ToolDefinition {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: name }], details: null }),
  };
}
