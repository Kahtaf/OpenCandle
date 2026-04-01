import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildSystemPrompt } from "../../../src/system-prompt.js";
import { getComprehensiveAnalysisPrompts } from "../../../src/analysts/orchestrator.js";
import { buildOptionsScreenerWorkflow, buildPortfolioWorkflow, buildCompareAssetsWorkflow } from "../../../src/workflows/index.js";
import { resolveOptionsScreenerSlots, resolvePortfolioSlots } from "../../../src/routing/index.js";
import { initDatabase, MemoryStorage } from "../../../src/memory/index.js";
import openCandleExtension from "../../../src/pi/opencandle-extension.js";

vi.mock("../../../src/memory/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/memory/index.js")>();
  return {
    ...actual,
    initDefaultDatabase: () => actual.initDatabase(":memory:"),
  };
});

type EventHandler = (...args: any[]) => any;

interface FakeUi {
  notify: ReturnType<typeof vi.fn>;
}

interface FakeCommandContext {
  isIdle(): boolean;
  hasPendingMessages?(): boolean;
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

describe("opencandle extension", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("registers the finance tool surface and analyze command", () => {
    const fake = createFakeApi();
    openCandleExtension(fake.api);

    expect(fake.tools).toHaveLength(24);
    expect(fake.commands.has("analyze")).toBe(true);
    expect(fake.commands.has("setup")).toBe(true);
  });

  it("queues the comprehensive analysis prompt sequence for /analyze", async () => {
    const fake = createFakeApi();
    openCandleExtension(fake.api);

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
      );
    }
  });

  it("intercepts natural-language analyze input and queues the same prompt sequence", async () => {
    const fake = createFakeApi();
    openCandleExtension(fake.api);

    let idle = false;
    fake.sendUserMessage.mockImplementation(() => {
      idle = true;
    });

    const inputHandler = fake.handlers.get("input")?.[0];
    expect(inputHandler).toBeDefined();

    const ctx = {
      isIdle: () => idle,
      hasPendingMessages: () => false,
      ui: { notify: vi.fn() },
    };

    const result = await inputHandler!(
      { type: "input", text: "analyze NVDA", source: "interactive" },
      ctx,
    );

    expect(result).toEqual({ action: "handled" });

    const prompts = getComprehensiveAnalysisPrompts("NVDA");
    await vi.runAllTimersAsync();
    expect(fake.sendUserMessage).toHaveBeenCalledTimes(prompts.length);
    expect(fake.sendUserMessage).toHaveBeenNthCalledWith(1, prompts[0], { deliverAs: "followUp" });
    for (const [index, prompt] of prompts.entries()) {
      if (index === 0) continue;
      expect(fake.sendUserMessage).toHaveBeenNthCalledWith(index + 1, prompt);
    }
    expect(ctx.ui.notify).toHaveBeenCalledWith("Analysis queued as follow-up.", "info");
  });

  it("appends the OpenCandle system prompt before agent start", async () => {
    const fake = createFakeApi();
    openCandleExtension(fake.api);

    const beforeStartHandler = fake.handlers.get("before_agent_start")?.[0];
    expect(beforeStartHandler).toBeDefined();

    const result = await beforeStartHandler!(
      { type: "before_agent_start", prompt: "What is AAPL doing?", systemPrompt: "BASE" },
      {},
    );

    expect(result.systemPrompt).toContain("BASE");
    expect(result.systemPrompt).toContain(buildSystemPrompt());
  });

  it("routes portfolio-builder prompts through the deterministic workflow", async () => {
    const fake = createFakeApi();
    openCandleExtension(fake.api);

    const inputHandler = fake.handlers.get("input")?.[0];
    const ctx = {
      isIdle: () => true,
      ui: { notify: vi.fn() },
    };

    const result = await inputHandler!(
      { type: "input", text: "Build me a diversified ETF portfolio with $10000 for a balanced risk profile.", source: "interactive" },
      ctx,
    );

    const workflow = buildPortfolioWorkflow(resolvePortfolioSlots({
      symbols: [],
      budget: 10_000,
      riskProfile: "balanced",
    }));

    expect(result).toEqual({ action: "handled" });
    expect(fake.sendUserMessage).toHaveBeenNthCalledWith(1, workflow.initialPrompt);
  });

  it("routes options-screening prompts through the deterministic workflow", async () => {
    const fake = createFakeApi();
    openCandleExtension(fake.api);

    const inputHandler = fake.handlers.get("input")?.[0];
    const ctx = {
      isIdle: () => true,
      ui: { notify: vi.fn() },
    };

    const result = await inputHandler!(
      { type: "input", text: "Screen bullish AAPL call options around 30 to 45 DTE with good liquidity.", source: "interactive" },
      ctx,
    );

    const workflow = buildOptionsScreenerWorkflow(resolveOptionsScreenerSlots({
      symbols: ["AAPL"],
      direction: "bullish",
    }));

    expect(result).toEqual({ action: "handled" });
    expect(fake.sendUserMessage).toHaveBeenNthCalledWith(1, workflow.initialPrompt);
  });

  it("routes compare prompts through the deterministic workflow", async () => {
    const fake = createFakeApi();
    openCandleExtension(fake.api);

    const inputHandler = fake.handlers.get("input")?.[0];
    const ctx = {
      isIdle: () => true,
      ui: { notify: vi.fn() },
    };

    const result = await inputHandler!(
      { type: "input", text: "Compare AAPL and MSFT side by side.", source: "interactive" },
      ctx,
    );

    const workflow = buildCompareAssetsWorkflow({
      resolved: { symbols: ["AAPL", "MSFT"] },
      sources: { symbols: "user" },
      defaultsUsed: [],
      missingRequired: [],
    });

    expect(result).toEqual({ action: "handled" });
    expect(fake.sendUserMessage).toHaveBeenNthCalledWith(1, workflow.initialPrompt);
  });

  describe("memory integration", () => {
    function createSessionCtx() {
      return {
        hasUI: false,
        sessionManager: { getSessionId: () => "test-session-id" },
        ui: { notify: vi.fn() },
      };
    }

    async function initMemory(fake: ReturnType<typeof createFakeApi>) {
      const sessionStartHandler = fake.handlers.get("session_start")?.[0];
      await sessionStartHandler!({ type: "session_start" }, createSessionCtx());
    }

    it("initializes storage on session_start", async () => {
      const fake = createFakeApi();
      openCandleExtension(fake.api);
      await initMemory(fake);

      // Storage is initialized — before_agent_start should include memory context
      const beforeStartHandler = fake.handlers.get("before_agent_start")?.[0];
      const result = await beforeStartHandler!(
        { type: "before_agent_start", prompt: "test", systemPrompt: "BASE" },
        {},
      );
      expect(result.systemPrompt).toContain("BASE");
      expect(result.systemPrompt).toContain(buildSystemPrompt());
    });

    it("extracts preferences from user input and passes them to slot resolvers", async () => {
      const fake = createFakeApi();
      openCandleExtension(fake.api);
      await initMemory(fake);

      const inputHandler = fake.handlers.get("input")?.[0];
      const ctx = { isIdle: () => true, ui: { notify: vi.fn() } };

      // Turn 1: state preference
      await inputHandler!(
        { type: "input", text: "I'm conservative and prefer ETFs", source: "interactive" },
        ctx,
      );

      // Turn 2: portfolio request — should use stored preference
      const result = await inputHandler!(
        { type: "input", text: "invest $10k", source: "interactive" },
        ctx,
      );

      expect(result).toEqual({ action: "handled" });
      // The prompt should use conservative from preference, not balanced default
      expect(fake.sendUserMessage.mock.calls[0][0]).toContain("conservative");
      expect(fake.sendUserMessage.mock.calls[0][0]).not.toContain("balanced [DEFAULT]");
    });

    it("records workflow runs after dispatch", async () => {
      const fake = createFakeApi();
      openCandleExtension(fake.api);
      await initMemory(fake);

      const inputHandler = fake.handlers.get("input")?.[0];
      const ctx = { isIdle: () => true, ui: { notify: vi.fn() } };

      await inputHandler!(
        { type: "input", text: "invest $10k in balanced portfolio", source: "interactive" },
        ctx,
      );

      // appendEntry should be called with workflow data
      expect(fake.api.appendEntry).toHaveBeenCalledWith(
        "opencandle-workflow",
        expect.objectContaining({ workflow: "portfolio_builder" }),
      );
    });

    it("injects memory context into system prompt after preferences are stored", async () => {
      const fake = createFakeApi();
      openCandleExtension(fake.api);
      await initMemory(fake);

      // Store a preference via input
      const inputHandler = fake.handlers.get("input")?.[0];
      const ctx = { isIdle: () => true, ui: { notify: vi.fn() } };
      await inputHandler!(
        { type: "input", text: "I'm conservative", source: "interactive" },
        ctx,
      );

      // Check system prompt includes the preference
      const beforeStartHandler = fake.handlers.get("before_agent_start")?.[0];
      const result = await beforeStartHandler!(
        { type: "before_agent_start", prompt: "test", systemPrompt: "BASE" },
        {},
      );
      expect(result.systemPrompt).toContain("risk_profile");
      expect(result.systemPrompt).toContain("conservative");
    });
  });

  it("cancels stale follow-ups when a newer workflow starts", async () => {
    const fake = createFakeApi();
    openCandleExtension(fake.api);

    const inputHandler = fake.handlers.get("input")?.[0];
    const ctx = {
      isIdle: () => true,
      hasPendingMessages: () => false,
      ui: { notify: vi.fn() },
    };

    await inputHandler!(
      { type: "input", text: "analyze NVDA", source: "interactive" },
      ctx,
    );
    await inputHandler!(
      { type: "input", text: "analyze AAPL", source: "interactive" },
      ctx,
    );

    await vi.runAllTimersAsync();

    const calls = fake.sendUserMessage.mock.calls.map((call) => call[0]);
    expect(calls[0]).toBe(getComprehensiveAnalysisPrompts("NVDA")[0]);
    expect(calls[1]).toBe(getComprehensiveAnalysisPrompts("AAPL")[0]);
    expect(calls).not.toContain(getComprehensiveAnalysisPrompts("NVDA")[1]);
    expect(calls).toContain(getComprehensiveAnalysisPrompts("AAPL")[1]);
  });
});
