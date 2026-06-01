import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getComprehensiveAnalysisPrompts } from "../../../src/analysts/orchestrator.js";
import { buildOptionsScreenerWorkflow, buildPortfolioWorkflow, buildCompareAssetsWorkflow } from "../../../src/workflows/index.js";
import { resolveOptionsScreenerSlots, resolvePortfolioSlots } from "../../../src/routing/index.js";
import openCandleExtension from "../../../src/pi/opencandle-extension.js";
import { resetConfigCache } from "../../../src/config.js";
import type { RouterLlmClient, RouterOutput } from "../../../src/routing/router-types.js";
import { SessionCoordinator } from "../../../src/runtime/session-coordinator.js";

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

function exactSymbolSearch(validSymbols: string[]) {
  const valid = new Set(validSymbols.map((symbol) => symbol.toUpperCase()));
  return async (query: string) =>
    valid.has(query.toUpperCase())
      ? [{
          symbol: query.toUpperCase(),
          name: query.toUpperCase(),
          quoteType: "EQUITY",
          assetType: "equity",
          exchange: "NMS",
          provider: "yahoo" as const,
          score: 1,
        }]
      : [];
}

describe("opencandle extension", () => {
  beforeEach(() => {
    vi.stubEnv("OPENCANDLE_ROUTER_MODE", "rules");
    resetConfigCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    resetConfigCache();
    vi.restoreAllMocks();
  });

  it("registers the finance tool surface and analyze command", () => {
    const fake = createFakeApi();
    openCandleExtension(fake.api);

    expect(fake.tools).toHaveLength(33);
    expect(fake.tools.map((tool) => tool.name)).toContain("screen_stocks");
    expect(fake.tools.map((tool) => tool.name)).toContain("analyze_holdings_overlap");
    expect(fake.tools.map((tool) => tool.name)).toContain("manage_alerts");
    expect(fake.tools.map((tool) => tool.name)).toContain("daily_watchlist_report");
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
    setTimeout(() => {
      idle = true;
    }, 5);

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

    const prompts = getComprehensiveAnalysisPrompts("NVDA");
    expect(result).toEqual({ action: "transform", text: prompts[0] });

    await vi.runAllTimersAsync();
    expect(fake.sendUserMessage).toHaveBeenCalledTimes(prompts.length - 1);
    for (const [index, prompt] of prompts.entries()) {
      if (index === 0) continue;
      expect(fake.sendUserMessage).toHaveBeenNthCalledWith(index, prompt);
    }
    expect(ctx.ui.notify).not.toHaveBeenCalledWith("Analysis queued as follow-up.", "info");
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
    // Composable prompt sections now build the system prompt
    expect(result.systemPrompt).toContain("OpenCandle");
    expect(result.systemPrompt).toContain("Available Tools");
    // Analyst stance replaces the Disclaimer block — verify committal posture
    // is present and refusal vocabulary is not.
    expect(result.systemPrompt.toLowerCase()).toContain("analyst");
    expect(result.systemPrompt.toLowerCase()).toContain("invalidation");
    expect(result.systemPrompt).not.toMatch(/\bnot financial advice\b/i);
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
      assetScope: "etf_focused",
    }));

    expect(result).toEqual({ action: "transform", text: workflow.initialPrompt });
    expect(fake.sendUserMessage).not.toHaveBeenCalledWith(workflow.initialPrompt);
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
      dteHint: "30 to 45 DTE",
    }));

    expect(result).toEqual({ action: "transform", text: workflow.initialPrompt });
    expect(fake.sendUserMessage).not.toHaveBeenCalledWith(workflow.initialPrompt);
  });

  it("routes compare prompts through the deterministic workflow", async () => {
    const fake = createFakeApi();
    openCandleExtension(fake.api, { symbolSearch: exactSymbolSearch(["AAPL", "MSFT"]) });

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

    expect(result).toEqual({ action: "transform", text: workflow.initialPrompt });
    expect(fake.sendUserMessage).not.toHaveBeenCalledWith(workflow.initialPrompt);
  });

  it("records a per-turn disclaimer entry (non-LLM-context) on final assistant turns", async () => {
    const fake = createFakeApi();
    openCandleExtension(fake.api);

    const turnEndHandler = fake.handlers.get("turn_end")?.[0];
    expect(turnEndHandler).toBeDefined();

    await turnEndHandler!(
      {
        type: "turn_end",
        turnIndex: 0,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "committal response" }],
          stopReason: "stop",
        },
        toolResults: [],
      },
      {},
    );

    const appendCall = (fake.api.appendEntry as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "opencandle-disclaimer",
    );
    expect(appendCall).toBeDefined();
    const text = (appendCall![1] as { text: string }).text;
    expect(text.length).toBeGreaterThan(0);
    expect(text.toLowerCase()).toMatch(/research|analyst|not .*fiduciary|informational/);
    // MUST NOT go via sendMessage (Pi maps CustomMessage → role:"user" in LLM context).
    const sent = (fake.api.sendMessage as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0]?.customType === "opencandle-disclaimer",
    );
    expect(sent).toBeUndefined();
  });

  it("does not record a disclaimer entry on intermediate tool-use turns", async () => {
    const fake = createFakeApi();
    openCandleExtension(fake.api);

    const turnEndHandler = fake.handlers.get("turn_end")?.[0];
    await turnEndHandler!(
      {
        type: "turn_end",
        turnIndex: 0,
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "x", name: "get_stock_quote", input: {} }],
          stopReason: "toolUse",
        },
        toolResults: [],
      },
      {},
    );

    const appendCall = (fake.api.appendEntry as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "opencandle-disclaimer",
    );
    expect(appendCall).toBeUndefined();
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

      // Storage is initialized — before_agent_start should include system prompt
      const beforeStartHandler = fake.handlers.get("before_agent_start")?.[0];
      const result = await beforeStartHandler!(
        { type: "before_agent_start", prompt: "test", systemPrompt: "BASE" },
        {},
      );
      expect(result.systemPrompt).toContain("BASE");
      expect(result.systemPrompt).toContain("OpenCandle");
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

      expect(result).toEqual(expect.objectContaining({ action: "transform" }));
      // The prompt should use conservative from preference, not balanced default
      expect(result.text).toContain("conservative");
      expect(result.text).not.toContain("balanced [DEFAULT]");
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
    let idle = false;
    setTimeout(() => {
      idle = true;
    }, 5);
    const ctx = {
      isIdle: () => idle,
      hasPendingMessages: () => false,
      ui: { notify: vi.fn() },
    };

    const firstResult = await inputHandler!(
      { type: "input", text: "analyze NVDA", source: "interactive" },
      ctx,
    );
    const secondResult = await inputHandler!(
      { type: "input", text: "analyze AAPL", source: "interactive" },
      ctx,
    );

    await vi.runAllTimersAsync();

    const calls = fake.sendUserMessage.mock.calls.map((call) => call[0]);
    expect(firstResult).toEqual({ action: "transform", text: getComprehensiveAnalysisPrompts("NVDA")[0] });
    expect(secondResult).toEqual({ action: "transform", text: getComprehensiveAnalysisPrompts("AAPL")[0] });
    // The NVDA follow-ups should have been cancelled
    expect(calls).not.toContain(getComprehensiveAnalysisPrompts("NVDA")[1]);
    // The AAPL follow-ups should proceed
    expect(calls).toContain(getComprehensiveAnalysisPrompts("AAPL")[1]);
  });

  it("clarifies rules-mode compare prompts when acronym drops leave too few symbols", async () => {
    const fake = createFakeApi();
    openCandleExtension(fake.api, { symbolSearch: exactSymbolSearch(["ASTS"]) });

    const sessionStart = fake.handlers.get("session_start")?.[0];
    await sessionStart!(
      { type: "session_start" },
      { hasUI: false, sessionManager: { getSessionId: () => "sid" }, ui: { notify: vi.fn() } },
    );

    const inputHandler = fake.handlers.get("input")?.[0];
    const ctx = {
      isIdle: () => true,
      ui: { notify: vi.fn() },
      sessionManager: { getBranch: () => [], getSessionId: () => "sid" },
    };

    const result = await inputHandler!(
      { type: "input", text: "Compare these assets: IV, ASTS", source: "interactive" },
      ctx,
    );

    expect(result).toBeUndefined();

    const symbolDrop = (fake.api.appendEntry as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "opencandle-symbol-dropped",
    );
    expect(symbolDrop).toBeDefined();
    expect(symbolDrop![1]).toMatchObject({
      token: "IV",
      reason: "no positive ticker signal",
      source: "rules",
    });

    const aborted = (fake.api.appendEntry as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "opencandle-workflow-aborted",
    );
    expect(aborted).toBeDefined();
    expect(aborted![1]).toMatchObject({
      reason: "symbol-disambiguation-insufficient-symbols",
      validSymbols: ["ASTS"],
    });

    const beforeAgentStart = fake.handlers.get("before_agent_start")?.[0];
    const promptResult = await beforeAgentStart!(
      { type: "before_agent_start", prompt: "test", systemPrompt: "BASE" },
      {},
    );
    expect(promptResult.systemPrompt).toContain("Clarification Playbook");
    expect(promptResult.systemPrompt).toContain("ask_user");
    expect(promptResult.systemPrompt).toContain("Dropped ambiguous ticker-like tokens: IV");
  });

  it("clarifies rules-mode compare prompts when ticker preflight leaves too few valid symbols", async () => {
    const fake = createFakeApi();
    openCandleExtension(fake.api, { symbolSearch: exactSymbolSearch(["AAPL"]) });

    const sessionStart = fake.handlers.get("session_start")?.[0];
    await sessionStart!(
      { type: "session_start" },
      { hasUI: false, sessionManager: { getSessionId: () => "sid" }, ui: { notify: vi.fn() } },
    );

    const inputHandler = fake.handlers.get("input")?.[0];
    const ctx = {
      isIdle: () => true,
      ui: { notify: vi.fn() },
      sessionManager: { getBranch: () => [], getSessionId: () => "sid" },
    };

    const result = await inputHandler!(
      { type: "input", text: "Compare AAPL and ZZZZ", source: "interactive" },
      ctx,
    );

    expect(result).toBeUndefined();
    const aborted = (fake.api.appendEntry as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "opencandle-workflow-aborted",
    );
    expect(aborted).toBeDefined();
    expect(aborted![1]).toMatchObject({
      reason: "preflight-insufficient-symbols",
    });

    const beforeAgentStart = fake.handlers.get("before_agent_start")?.[0];
    const promptResult = await beforeAgentStart!(
      { type: "before_agent_start", prompt: "test", systemPrompt: "BASE" },
      {},
    );
    expect(promptResult.systemPrompt).toContain("Fallback Playbook");
    expect(promptResult.systemPrompt).toContain("ask_user");
    expect(promptResult.systemPrompt).toContain("ticker preflight left fewer than two valid symbols");
  });

  describe("llm router mode dispatch signal", () => {
    // Regression guard: in llm mode, when the router dispatches a workflow,
    // the input handler MUST transform the current prompt into the first
    // workflow prompt so Pi does not also forward the original user turn.
    // Fallback turns, by contrast, MUST return undefined so the main agent
    // runs on the user turn under the router-supplied fallback context.

    beforeEach(() => {
      vi.stubEnv("OPENCANDLE_ROUTER_MODE", "llm");
      resetConfigCache();
    });

    function mockClient(output: RouterOutput): RouterLlmClient {
      return {
        async complete() {
          return JSON.stringify(output);
        },
      };
    }

    const workflowOutput: RouterOutput = {
      route: "workflow",
      workflow: "portfolio_builder",
      entities: { symbols: [], budget: 10_000 },
      slots: {
        budget: { value: 10_000, source: "user", confidence: "high" },
        riskProfile: { value: "balanced", source: "default", confidence: "high" },
      },
      preference_updates: [],
      missing_required: [],
      reasoning: "",
    };

    const fallbackOutput: RouterOutput = {
      route: "fallback",
      entities: { symbols: ["ASTS"], timeHorizon: "6mo" },
      slots: {
        symbols: { value: ["ASTS"], source: "user", confidence: "high" },
        timeHorizon: { value: "6mo", source: "user", confidence: "high" },
      },
      preference_updates: [],
      missing_required: [],
      reasoning: "",
    };

    // Router mode reads priorTurns from `ctx.sessionManager.getBranch()`, so
    // input-handler ctxs used in these tests must carry a minimal session
    // manager stub. An empty branch is the right default — these fixtures
    // simulate a fresh turn, not a multi-turn conversation.
    const emptySessionManager = { getBranch: () => [], getSessionId: () => "sid" };

    it("returns a transform result when router dispatches a workflow", async () => {
      const fake = createFakeApi();
      openCandleExtension(fake.api, { routerLlmClient: mockClient(workflowOutput) });

      // Init session so storage is available for pref writes.
      const sessionStart = fake.handlers.get("session_start")?.[0];
      await sessionStart!(
        { type: "session_start" },
        { hasUI: false, sessionManager: { getSessionId: () => "sid" }, ui: { notify: vi.fn() } },
      );

      const inputHandler = fake.handlers.get("input")?.[0];
      const ctx = {
        isIdle: () => true,
        ui: { notify: vi.fn() },
        model: { id: "m" },
        sessionManager: emptySessionManager,
      };

      const result = await inputHandler!(
        { type: "input", text: "invest $10k", source: "interactive" },
        ctx,
      );

      expect(result).toEqual(expect.objectContaining({ action: "transform" }));
    });

    it("dispatches portfolio workflows using budget supplied only by router slots", async () => {
      const slotOnlyBudgetOutput: RouterOutput = {
        routeKind: "workflow_dispatch",
        route: "workflow",
        workflow: "portfolio_builder",
        entities: { symbols: [] },
        slots: {
          budget: { value: 25_000, source: "preference", confidence: "high" },
        },
        preference_updates: [],
        missing_required: [],
        tool_bundles: [],
        diagnostics: [],
        reasoning: "saved profile supplies budget",
      };
      const fake = createFakeApi();
      openCandleExtension(fake.api, { routerLlmClient: mockClient(slotOnlyBudgetOutput) });

      const sessionStart = fake.handlers.get("session_start")?.[0];
      await sessionStart!(
        { type: "session_start" },
        { hasUI: false, sessionManager: { getSessionId: () => "sid" }, ui: { notify: vi.fn() } },
      );

      const inputHandler = fake.handlers.get("input")?.[0];
      const ctx = {
        isIdle: () => true,
        ui: { notify: vi.fn() },
        model: { id: "m" },
        sessionManager: emptySessionManager,
      };

      const result = await inputHandler!(
        { type: "input", text: "build me a portfolio like before", source: "interactive" },
        ctx,
      );

      expect(result).toEqual(expect.objectContaining({ action: "transform" }));
      expect(result.text).toContain("Budget: $25,000");
      expect(result.text).toContain("From saved preferences: budget");
    });

    it("dispatches options workflows using a symbol supplied only by router slots", async () => {
      const slotOnlySymbolOutput: RouterOutput = {
        routeKind: "workflow_dispatch",
        route: "workflow",
        workflow: "options_screener",
        entities: { symbols: [], direction: "bullish" },
        slots: {
          symbol: { value: "msft", source: "prior_context", confidence: "high" },
        },
        preference_updates: [],
        missing_required: [],
        tool_bundles: [],
        diagnostics: [],
        reasoning: "prior context supplies the underlying",
      };
      const fake = createFakeApi();
      openCandleExtension(fake.api, { routerLlmClient: mockClient(slotOnlySymbolOutput) });

      const sessionStart = fake.handlers.get("session_start")?.[0];
      await sessionStart!(
        { type: "session_start" },
        { hasUI: false, sessionManager: { getSessionId: () => "sid" }, ui: { notify: vi.fn() } },
      );

      const inputHandler = fake.handlers.get("input")?.[0];
      const ctx = {
        isIdle: () => true,
        ui: { notify: vi.fn() },
        model: { id: "m" },
        sessionManager: emptySessionManager,
      };

      const result = await inputHandler!(
        { type: "input", text: "what about calls now?", source: "interactive" },
        ctx,
      );

      expect(result).toEqual(expect.objectContaining({ action: "transform" }));
      expect(result.text).toContain("Screen and rank options contracts for MSFT");
      expect(result.text).toContain("From prior context: symbol");
    });

    it("dispatches compare workflows using symbols supplied only by router slots", async () => {
      const slotOnlySymbolsOutput: RouterOutput = {
        routeKind: "workflow_dispatch",
        route: "workflow",
        workflow: "compare_assets",
        entities: { symbols: [] },
        slots: {
          symbols: { value: ["spy", "qqq"], source: "memory", confidence: "high" },
        },
        preference_updates: [],
        missing_required: [],
        tool_bundles: [],
        diagnostics: [],
        reasoning: "memory supplies comparison set",
      };
      const fake = createFakeApi();
      openCandleExtension(fake.api, {
        routerLlmClient: mockClient(slotOnlySymbolsOutput),
        symbolSearch: exactSymbolSearch(["SPY", "QQQ"]),
      });

      const sessionStart = fake.handlers.get("session_start")?.[0];
      await sessionStart!(
        { type: "session_start" },
        { hasUI: false, sessionManager: { getSessionId: () => "sid" }, ui: { notify: vi.fn() } },
      );

      const inputHandler = fake.handlers.get("input")?.[0];
      const ctx = {
        isIdle: () => true,
        ui: { notify: vi.fn() },
        model: { id: "m" },
        sessionManager: emptySessionManager,
      };

      const result = await inputHandler!(
        { type: "input", text: "compare them side by side", source: "interactive" },
        ctx,
      );

      expect(result).toEqual(expect.objectContaining({ action: "transform" }));
      expect(result.text).toContain("Compare these assets side by side: SPY, QQQ");
      expect(result.text).toContain("From memory: symbols");
    });

    it("preflights compare workflow symbols before dispatch", async () => {
      const compareOutput: RouterOutput = {
        routeKind: "workflow_dispatch",
        route: "workflow",
        workflow: "compare_assets",
        entities: { symbols: ["AAPL", "XXFAKEXX", "MSFT"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        tool_bundles: [],
        diagnostics: [],
        reasoning: "compare requested assets",
      };
      const fake = createFakeApi();
      openCandleExtension(fake.api, {
        routerLlmClient: mockClient(compareOutput),
        symbolSearch: exactSymbolSearch(["AAPL", "MSFT"]),
      });

      const sessionStart = fake.handlers.get("session_start")?.[0];
      await sessionStart!(
        { type: "session_start" },
        { hasUI: false, sessionManager: { getSessionId: () => "sid" }, ui: { notify: vi.fn() } },
      );

      const inputHandler = fake.handlers.get("input")?.[0];
      const ctx = {
        isIdle: () => true,
        ui: { notify: vi.fn() },
        model: { id: "m" },
        sessionManager: emptySessionManager,
      };

      const result = await inputHandler!(
        { type: "input", text: "compare AAPL, XXFAKEXX, MSFT", source: "interactive" },
        ctx,
      );

      expect(result).toEqual(expect.objectContaining({ action: "transform" }));
      expect(result.text).toContain("[Pre-flight: dropped 1 unknown symbol - XXFAKEXX");
      expect(result.text).toContain("Compare these assets side by side: AAPL, MSFT");
      expect(result.text).not.toContain("AAPL, XXFAKEXX, MSFT");

      const call = (fake.api.appendEntry as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === "opencandle-symbol-preflight-dropped",
      );
      expect(call).toBeDefined();
      expect(call![1]).toMatchObject({
        symbol: "XXFAKEXX",
        reason: "no matching ticker found via resolver search",
      });
    });

    it("aborts compare workflow dispatch when preflight leaves too few symbols", async () => {
      const compareOutput: RouterOutput = {
        routeKind: "workflow_dispatch",
        route: "workflow",
        workflow: "compare_assets",
        entities: { symbols: ["ZZZBAD", "XXFAKEXX"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        tool_bundles: [],
        diagnostics: [],
        reasoning: "compare requested assets",
      };
      const fake = createFakeApi();
      openCandleExtension(fake.api, {
        routerLlmClient: mockClient(compareOutput),
        symbolSearch: exactSymbolSearch([]),
      });

      const sessionStart = fake.handlers.get("session_start")?.[0];
      await sessionStart!(
        { type: "session_start" },
        { hasUI: false, sessionManager: { getSessionId: () => "sid" }, ui: { notify: vi.fn() } },
      );

      const inputHandler = fake.handlers.get("input")?.[0];
      const ctx = {
        isIdle: () => true,
        ui: { notify: vi.fn() },
        model: { id: "m" },
        sessionManager: emptySessionManager,
      };

      const result = await inputHandler!(
        { type: "input", text: "compare ZZZBAD and XXFAKEXX", source: "interactive" },
        ctx,
      );

      expect(result).toBeUndefined();
      const call = (fake.api.appendEntry as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === "opencandle-workflow-aborted",
      );
      expect(call).toBeDefined();
      expect(call![1]).toMatchObject({
        reason: "preflight-insufficient-symbols",
      });
    });

    it("returns undefined for fallback turns so the main agent runs", async () => {
      const fake = createFakeApi();
      openCandleExtension(fake.api, { routerLlmClient: mockClient(fallbackOutput) });

      const sessionStart = fake.handlers.get("session_start")?.[0];
      await sessionStart!(
        { type: "session_start" },
        { hasUI: false, sessionManager: { getSessionId: () => "sid" }, ui: { notify: vi.fn() } },
      );

      const inputHandler = fake.handlers.get("input")?.[0];
      const ctx = {
        isIdle: () => true,
        ui: { notify: vi.fn() },
        model: { id: "m" },
        sessionManager: emptySessionManager,
      };

      const result = await inputHandler!(
        { type: "input", text: "Give me entry levels on ASTS for a 6 month horizon", source: "interactive" },
        ctx,
      );

      expect(result).toBeUndefined();
    });

    it("does not record pass-through turns as finance workflow history", async () => {
      const passThroughOutput: RouterOutput = {
        routeKind: "pass_through",
        route: "fallback",
        entities: { symbols: [] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "non-finance request",
        tool_bundles: [],
        diagnostics: [],
      };
      const recordSpy = vi.spyOn(SessionCoordinator.prototype, "recordWorkflowRun");
      const fake = createFakeApi();
      openCandleExtension(fake.api, { routerLlmClient: mockClient(passThroughOutput) });

      const sessionStart = fake.handlers.get("session_start")?.[0];
      await sessionStart!(
        { type: "session_start" },
        { hasUI: false, sessionManager: { getSessionId: () => "sid" }, ui: { notify: vi.fn() } },
      );

      const inputHandler = fake.handlers.get("input")?.[0];
      const ctx = {
        isIdle: () => true,
        ui: { notify: vi.fn() },
        model: { id: "m" },
        sessionManager: emptySessionManager,
      };

      const result = await inputHandler!(
        { type: "input", text: "write a haiku", source: "interactive" },
        ctx,
      );

      expect(result).toBeUndefined();
      expect(recordSpy).not.toHaveBeenCalled();
    });

    it("logs dropped medium/low-confidence preferences even when no storage is available", async () => {
      // Regression guard: observability must not silently drop when storage
      // is absent — task 8.2 logs `opencandle-router-prefs-dropped` on any
      // path where a low/medium-confidence extraction would have been skipped.
      const outputWithDrops: RouterOutput = {
        ...fallbackOutput,
        preference_updates: [
          { key: "risk_profile", value: "aggressive", confidence: "medium", source: "inferred" },
        ],
      };
      const fake = createFakeApi();
      openCandleExtension(fake.api, { routerLlmClient: mockClient(outputWithDrops) });
      // Deliberately skip session_start — storage stays null.

      const inputHandler = fake.handlers.get("input")?.[0];
      const ctx = {
        isIdle: () => true,
        ui: { notify: vi.fn() },
        model: { id: "m" },
        sessionManager: emptySessionManager,
      };

      await inputHandler!(
        { type: "input", text: "maybe aggressive", source: "interactive" },
        ctx,
      );

      const call = (fake.api.appendEntry as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === "opencandle-router-prefs-dropped",
      );
      expect(call).toBeDefined();
      expect((call![1] as { dropped: unknown[] }).dropped).toHaveLength(1);
    });

    it("logs router symbol drops as custom entries", async () => {
      const symbolDropOutput: RouterOutput = {
        routeKind: "workflow_dispatch",
        route: "workflow",
        workflow: "compare_assets",
        entities: { symbols: ["IV", "ASTS"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        tool_bundles: [],
        diagnostics: [],
        reasoning: "compare assets",
      };
      const fake = createFakeApi();
      openCandleExtension(fake.api, { routerLlmClient: mockClient(symbolDropOutput) });

      const sessionStart = fake.handlers.get("session_start")?.[0];
      await sessionStart!(
        { type: "session_start" },
        { hasUI: false, sessionManager: { getSessionId: () => "sid" }, ui: { notify: vi.fn() } },
      );

      const inputHandler = fake.handlers.get("input")?.[0];
      const ctx = {
        isIdle: () => true,
        ui: { notify: vi.fn() },
        model: { id: "m" },
        sessionManager: emptySessionManager,
      };

      await inputHandler!(
        { type: "input", text: "Compare these assets: IV, ASTS", source: "interactive" },
        ctx,
      );

      const call = (fake.api.appendEntry as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === "opencandle-symbol-dropped",
      );
      expect(call).toBeDefined();
      expect(call![1]).toMatchObject({
        token: "IV",
        reason: "no positive ticker signal",
        source: "llm",
      });
    });

    it("does not reintroduce dropped LLM symbols from router slots", async () => {
      const symbolDropOutput: RouterOutput = {
        routeKind: "workflow_dispatch",
        route: "workflow",
        workflow: "compare_assets",
        entities: { symbols: ["IV", "ASTS"] },
        slots: {
          symbols: { value: ["IV", "ASTS"], source: "user", confidence: "high" },
        },
        preference_updates: [],
        missing_required: [],
        tool_bundles: [],
        diagnostics: [],
        reasoning: "compare assets",
      };
      const fake = createFakeApi();
      openCandleExtension(fake.api, {
        routerLlmClient: mockClient(symbolDropOutput),
        symbolSearch: exactSymbolSearch(["IV", "ASTS"]),
      });

      const sessionStart = fake.handlers.get("session_start")?.[0];
      await sessionStart!(
        { type: "session_start" },
        { hasUI: false, sessionManager: { getSessionId: () => "sid" }, ui: { notify: vi.fn() } },
      );

      const inputHandler = fake.handlers.get("input")?.[0];
      const ctx = {
        isIdle: () => true,
        ui: { notify: vi.fn() },
        model: { id: "m" },
        sessionManager: emptySessionManager,
      };

      const result = await inputHandler!(
        { type: "input", text: "Compare these assets: IV, ASTS", source: "interactive" },
        ctx,
      );

      expect(result).toBeUndefined();
      expect(fake.api.appendEntry).not.toHaveBeenCalledWith(
        "opencandle-workflow",
        expect.objectContaining({ symbols: ["IV", "ASTS"] }),
      );
    });
  });

  describe("soft-degradation accumulator wiring", () => {
    const SOFT_DEGRADED_TAG_BRAVE =
      '[OPENCANDLE_SOFT_DEGRADED provider=brave fallback=ddg remediation="run /connect search to enable Brave"]';
    const SOFT_DEGRADED_TAG_EXA =
      '[OPENCANDLE_SOFT_DEGRADED provider=exa fallback=keyless-mcp remediation="run /connect search to enable Exa"]';

    function toolResultEvent(text: string) {
      return {
        type: "tool_result" as const,
        toolCallId: "call-1",
        toolName: "web_search",
        content: [{ type: "text" as const, text }],
      };
    }

    it("records soft-degraded tags in the accumulator without mutating the tool result", async () => {
      // 11.1 — soft-degraded tool results must pass through unchanged. The
      // handler's return value should be undefined (Pi's convention for "no
      // modification"), and the per-turn accumulator is internal state we
      // verify indirectly via the turn_end flush.
      const fake = createFakeApi();
      openCandleExtension(fake.api);

      const toolResultHandler = fake.handlers.get("tool_result")?.[0];
      expect(toolResultHandler).toBeDefined();

      const ctx = { ui: { notify: vi.fn() } };
      const result = await toolResultHandler!(toolResultEvent(SOFT_DEGRADED_TAG_BRAVE), ctx);

      // Passthrough — no content replacement.
      expect(result).toBeUndefined();
      // No user prompt surfaces were invoked for a soft-degraded tag.
      expect(fake.sendUserMessage).not.toHaveBeenCalled();
    });

    it("flushes the combined annotation via appendEntry on turn_end", async () => {
      // 11.2 — after at least one soft-degraded tag this turn, the turn_end
      // handler should emit a single `opencandle-turn-gap` entry containing
      // a newline-joined list of [OPENCANDLE_SKIPPED ...] tags (one per
      // distinct provider recorded). Nothing is emitted when the accumulator
      // is empty.
      const fake = createFakeApi();
      openCandleExtension(fake.api);

      const toolResultHandler = fake.handlers.get("tool_result")?.[0];
      const turnEndHandler = fake.handlers.get("turn_end")?.[0];
      expect(turnEndHandler).toBeDefined();

      const ctx = { ui: { notify: vi.fn() } };
      await toolResultHandler!(toolResultEvent(SOFT_DEGRADED_TAG_BRAVE), ctx);
      await toolResultHandler!(toolResultEvent(SOFT_DEGRADED_TAG_EXA), ctx);

      (fake.api.appendEntry as any).mockClear();
      await turnEndHandler!({ type: "turn_end", turnIndex: 0, message: {}, toolResults: [] }, ctx);

      expect(fake.api.appendEntry).toHaveBeenCalledTimes(1);
      const [customType, payload] = (fake.api.appendEntry as any).mock.calls[0];
      expect(customType).toBe("opencandle-turn-gap");
      expect(payload.annotation).toContain("[OPENCANDLE_SKIPPED");
      expect(payload.annotation).toContain("provider=brave");
      expect(payload.annotation).toContain("provider=exa");
    });

    it("does not emit an opencandle-turn-gap entry when no degradations were recorded", async () => {
      const fake = createFakeApi();
      openCandleExtension(fake.api);

      const turnEndHandler = fake.handlers.get("turn_end")?.[0];
      const ctx = { ui: { notify: vi.fn() } };

      (fake.api.appendEntry as any).mockClear();
      await turnEndHandler!({ type: "turn_end", turnIndex: 0, message: {}, toolResults: [] }, ctx);

      // Only the turn-gap customType should be absent — other appendEntry
      // calls from workflow tracking are fine.
      const turnGapCalls = (fake.api.appendEntry as any).mock.calls.filter(
        (call: any[]) => call[0] === "opencandle-turn-gap",
      );
      expect(turnGapCalls).toHaveLength(0);
    });

    it("resets the accumulator between turns", async () => {
      // Consecutive turn_end events after a single recording should only
      // flush once. The second turn_end (with no new recordings) must not
      // re-emit the previous turn's providers.
      const fake = createFakeApi();
      openCandleExtension(fake.api);

      const toolResultHandler = fake.handlers.get("tool_result")?.[0];
      const turnStartHandler = fake.handlers.get("turn_start")?.[0];
      const turnEndHandler = fake.handlers.get("turn_end")?.[0];
      const ctx = { ui: { notify: vi.fn() } };

      await toolResultHandler!(toolResultEvent(SOFT_DEGRADED_TAG_BRAVE), ctx);
      (fake.api.appendEntry as any).mockClear();
      await turnEndHandler!({ type: "turn_end", turnIndex: 0, message: {}, toolResults: [] }, ctx);
      expect(
        (fake.api.appendEntry as any).mock.calls.filter(
          (c: any[]) => c[0] === "opencandle-turn-gap",
        ),
      ).toHaveLength(1);

      await turnStartHandler!({ type: "turn_start", turnIndex: 1, timestamp: Date.now() }, ctx);
      (fake.api.appendEntry as any).mockClear();
      await turnEndHandler!({ type: "turn_end", turnIndex: 1, message: {}, toolResults: [] }, ctx);
      expect(
        (fake.api.appendEntry as any).mock.calls.filter(
          (c: any[]) => c[0] === "opencandle-turn-gap",
        ),
      ).toHaveLength(0);
    });
  });
});
