import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildSystemPrompt } from "../../../src/system-prompt.js";
import { getComprehensiveAnalysisPrompts } from "../../../src/analysts/orchestrator.js";
import vantageExtension from "../../../src/pi/vantage-extension.js";

type EventHandler = (...args: any[]) => any;

interface FakeUi {
  notify: ReturnType<typeof vi.fn>;
}

interface FakeCommandContext {
  isIdle(): boolean;
  ui: FakeUi;
}

function createFakeApi() {
  const tools: any[] = [];
  const commands = new Map<string, { description?: string; handler: (args: string, ctx: FakeCommandContext) => Promise<void> }>();
  const handlers = new Map<string, EventHandler[]>();
  const sendUserMessage = vi.fn();

  const api: ExtensionAPI = {
    on(event: string, handler: EventHandler) {
      const bucket = handlers.get(event) ?? [];
      bucket.push(handler);
      handlers.set(event, bucket);
    },
    registerTool(tool) {
      tools.push(tool);
    },
    registerCommand(name, options) {
      commands.set(name, options as any);
    },
    registerShortcut: vi.fn(),
    registerFlag: vi.fn(),
    getFlag: vi.fn(),
    registerMessageRenderer: vi.fn(),
    sendMessage: vi.fn(),
    sendUserMessage,
    appendEntry: vi.fn(),
    setSessionName: vi.fn(),
    getSessionName: vi.fn(),
    setLabel: vi.fn(),
    exec: vi.fn(),
    getActiveTools: vi.fn(),
    getAllTools: vi.fn(),
    setActiveTools: vi.fn(),
    getCommands: vi.fn(),
    setModel: vi.fn(),
    getThinkingLevel: vi.fn(),
    setThinkingLevel: vi.fn(),
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
  } as unknown as ExtensionAPI;

  return { api, tools, commands, handlers, sendUserMessage };
}

describe("vantage extension", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("registers the finance tool surface and analyze command", () => {
    const fake = createFakeApi();
    vantageExtension(fake.api);

    expect(fake.tools).toHaveLength(23);
    expect(fake.commands.has("analyze")).toBe(true);
  });

  it("queues the comprehensive analysis prompt sequence for /analyze", async () => {
    const fake = createFakeApi();
    vantageExtension(fake.api);

    const ctx: FakeCommandContext = {
      isIdle: () => true,
      ui: { notify: vi.fn() },
    };

    await fake.commands.get("analyze")!.handler("NVDA", ctx);
    expect(fake.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(fake.sendUserMessage).toHaveBeenNthCalledWith(
      1,
      getComprehensiveAnalysisPrompts("NVDA")[0],
    );

    await vi.runAllTimersAsync();

    const prompts = getComprehensiveAnalysisPrompts("NVDA");
    expect(fake.sendUserMessage).toHaveBeenCalledTimes(prompts.length);
    for (const [index, prompt] of prompts.entries()) {
      if (index === 0) continue;
      expect(fake.sendUserMessage).toHaveBeenNthCalledWith(
        index + 1,
        prompt,
        { deliverAs: "followUp" },
      );
    }
  });

  it("intercepts natural-language analyze input and queues the same prompt sequence", async () => {
    const fake = createFakeApi();
    vantageExtension(fake.api);

    const inputHandler = fake.handlers.get("input")?.[0];
    expect(inputHandler).toBeDefined();

    const ctx = {
      isIdle: () => false,
      ui: { notify: vi.fn() },
    };

    const result = await inputHandler!(
      { type: "input", text: "analyze NVDA", source: "interactive" },
      ctx,
    );

    expect(result).toEqual({ action: "handled" });

    const prompts = getComprehensiveAnalysisPrompts("NVDA");
    expect(fake.sendUserMessage).toHaveBeenCalledTimes(prompts.length);
    for (const [index, prompt] of prompts.entries()) {
      expect(fake.sendUserMessage).toHaveBeenNthCalledWith(
        index + 1,
        prompt,
        { deliverAs: "followUp" },
      );
    }
    expect(ctx.ui.notify).toHaveBeenCalledWith("Analysis queued as follow-up.", "info");
  });

  it("appends the Vantage system prompt before agent start", async () => {
    const fake = createFakeApi();
    vantageExtension(fake.api);

    const beforeStartHandler = fake.handlers.get("before_agent_start")?.[0];
    expect(beforeStartHandler).toBeDefined();

    const result = await beforeStartHandler!(
      { type: "before_agent_start", prompt: "What is AAPL doing?", systemPrompt: "BASE" },
      {},
    );

    expect(result.systemPrompt).toContain("BASE");
    expect(result.systemPrompt).toContain(buildSystemPrompt());
  });
});
