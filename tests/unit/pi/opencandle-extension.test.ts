import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildComprehensiveAnalysisDefinition } from "../../../src/analysts/orchestrator.js";
import { resetConfigCache } from "../../../src/config.js";
import { initDatabase, initDefaultDatabase } from "../../../src/memory/sqlite.js";
import {
  loadOnboardingState,
  markProviderNeverAsk,
  saveOnboardingState,
} from "../../../src/onboarding/state.js";
import openCandleExtension from "../../../src/pi/opencandle-extension.js";
import { getOpenCandleToolDefinitions } from "../../../src/pi/tool-adapter.js";
import type { RouterLlmClient, RouterOutput } from "../../../src/routing/router-types.js";
import { SessionCoordinator } from "../../../src/runtime/session-coordinator.js";

vi.mock("../../../src/memory/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/memory/index.js")>();
  return {
    ...actual,
    initDefaultDatabase: () => actual.initDatabase(":memory:"),
  };
});

vi.mock("../../../src/memory/sqlite.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/memory/sqlite.js")>();
  return {
    ...actual,
    initDefaultDatabase: vi.fn(() => actual.initDatabase(":memory:")),
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
  sessionManager?: { getBranch?: () => unknown[]; getEntries?: () => unknown[] };
}

function createFakeApi() {
  const tools: any[] = [];
  const commands = new Map<
    string,
    { description?: string; handler: (args: string, ctx: FakeCommandContext) => Promise<void> }
  >();
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
      ? [
          {
            symbol: query.toUpperCase(),
            name: query.toUpperCase(),
            quoteType: "EQUITY",
            assetType: "equity",
            exchange: "NMS",
            provider: "yahoo" as const,
            score: 1,
          },
        ]
      : [];
}

function comprehensiveAnalysisPrompts(symbol: string): string[] {
  return buildComprehensiveAnalysisDefinition(symbol).steps.map((step) => step.prompt);
}

describe("opencandle extension", () => {
  beforeEach(() => {
    vi.stubEnv("OPENCANDLE_ROUTER_MODE", "");
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

    expect(fake.tools).toHaveLength(getOpenCandleToolDefinitions().length + 1);
    expect(fake.tools.map((tool) => tool.name)).toContain("screen_stocks");
    expect(fake.tools.map((tool) => tool.name)).toContain("analyze_holdings_overlap");
    expect(fake.tools.map((tool) => tool.name)).toContain("manage_alerts");
    expect(fake.tools.map((tool) => tool.name)).toContain("daily_watchlist_report");
    expect(fake.tools.map((tool) => tool.name)).toContain("manage_notifications");
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
    expect(fake.api.appendEntry).toHaveBeenCalledWith("opencandle-workflow", {
      workflow: "comprehensive_analysis",
      resolvedSlots: { symbol: "NVDA" },
      analystsTotal: 5,
    });
    expect(
      (fake.api.appendEntry as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([type]) => type === "opencandle-workflow",
      ),
    ).toHaveLength(1);
    expect(fake.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(fake.sendUserMessage).toHaveBeenNthCalledWith(
      1,
      comprehensiveAnalysisPrompts("NVDA")[0],
    );

    await vi.runAllTimersAsync();

    // This fake yields no assistant text, so every structured step re-prompts
    // once (interleaved "revise" messages) and, with zero parsed analysts,
    // the rebuttal runs instead of being skipped as false consensus.
    const prompts = comprehensiveAnalysisPrompts("NVDA");
    const canonicalCalls = (fake.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls
      .map(([prompt]) => prompt as string)
      .filter((prompt) => prompts.includes(prompt));
    expect(canonicalCalls).toEqual(prompts);
    expect(fake.api.appendEntry).not.toHaveBeenCalledWith(
      "opencandle-workflow-event",
      expect.objectContaining({ eventType: "step_skipped", stepType: "debate_rebuttal" }),
    );
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

    const prompts = comprehensiveAnalysisPrompts("NVDA");
    expect(result).toEqual({ action: "transform", text: prompts[0] });
    expect(fake.api.appendEntry).toHaveBeenCalledWith("opencandle-workflow", {
      workflow: "comprehensive_analysis",
      resolvedSlots: { symbol: "NVDA" },
      analystsTotal: 5,
    });
    expect(
      (fake.api.appendEntry as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([type]) => type === "opencandle-workflow",
      ),
    ).toHaveLength(1);

    await vi.runAllTimersAsync();
    // Same all-unparsed degradation semantics as the /analyze command test:
    // canonical follow-up prompts arrive in order with revise re-prompts
    // interleaved, and the rebuttal is dispatched (no consensus to gate on).
    const sentFollowUps = prompts.filter((_, index) => index !== 0);
    const canonicalCalls = (fake.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls
      .map(([prompt]) => prompt as string)
      .filter((prompt) => sentFollowUps.includes(prompt));
    expect(canonicalCalls).toEqual(sentFollowUps);
    expect(ctx.ui.notify).not.toHaveBeenCalledWith("Analysis queued as follow-up.", "info");
    expect(fake.api.appendEntry).not.toHaveBeenCalledWith(
      "opencandle-workflow-event",
      expect.objectContaining({ eventType: "step_skipped", stepType: "debate_rebuttal" }),
    );
  });

  it("records the original user text when a workflow transform replaces the turn", async () => {
    const fake = createFakeApi();
    openCandleExtension(fake.api);

    const inputHandler = fake.handlers.get("input")?.[0];
    const ctx = {
      isIdle: () => true,
      hasPendingMessages: () => false,
      ui: { notify: vi.fn() },
    };

    const result = await inputHandler!(
      { type: "input", text: "analyze NVDA", source: "interactive" },
      ctx,
    );

    expect(result).toMatchObject({ action: "transform" });
    const markerCall = (fake.api.appendEntry as ReturnType<typeof vi.fn>).mock.calls.find(
      ([type]) => type === "opencandle-user-input",
    );
    expect(markerCall?.[1]).toEqual({ original: "analyze NVDA" });
  });

  it("does not duplicate an unconsumed server-written original-input marker", async () => {
    const fake = createFakeApi();
    openCandleExtension(fake.api);

    const inputHandler = fake.handlers.get("input")?.[0];
    const ctx = {
      isIdle: () => true,
      hasPendingMessages: () => false,
      ui: { notify: vi.fn() },
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: "opencandle-user-input",
            data: {
              original: "analyze NVDA",
              attachments: [{ kind: "portfolio", label: "Portfolio" }],
            },
          },
        ],
      },
    };

    const result = await inputHandler!(
      { type: "input", text: "analyze NVDA", source: "interactive" },
      ctx,
    );

    expect(result).toMatchObject({ action: "transform" });
    expect(fake.api.appendEntry).not.toHaveBeenCalledWith(
      "opencandle-user-input",
      expect.anything(),
    );
  });

  it("records a new original user text after the previous marker has been consumed", async () => {
    const fake = createFakeApi();
    openCandleExtension(fake.api);

    const inputHandler = fake.handlers.get("input")?.[0];
    const ctx = {
      isIdle: () => true,
      hasPendingMessages: () => false,
      ui: { notify: vi.fn() },
      sessionManager: {
        getBranch: () => [
          { type: "message", message: { role: "user", content: "expanded workflow prompt" } },
          {
            type: "custom",
            customType: "opencandle-user-input",
            data: { original: "analyze NVDA" },
          },
          { type: "message", message: { role: "assistant", content: "analysis" } },
        ],
      },
    };

    const result = await inputHandler!(
      { type: "input", text: "analyze MSFT", source: "interactive" },
      ctx,
    );

    expect(result).toMatchObject({ action: "transform" });
    expect(fake.api.appendEntry).toHaveBeenCalledWith("opencandle-user-input", {
      original: "analyze MSFT",
    });
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
    const stateDatabaseFactory = () => initDatabase(":memory:");

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
      openCandleExtension(fake.api, { stateDatabaseFactory });
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

    it("provisions native persistence when loaded as a standalone Pi extension", async () => {
      vi.mocked(initDefaultDatabase).mockClear();
      const fake = createFakeApi();
      openCandleExtension(fake.api);
      const callsBeforeSessionStart = vi.mocked(initDefaultDatabase).mock.calls.length;

      await initMemory(fake);

      expect(vi.mocked(initDefaultDatabase).mock.calls.length).toBe(callsBeforeSessionStart + 1);
    });

    it("records workflow runs after router dispatch", async () => {
      const fake = createFakeApi();
      const workflowOutput = {
        route: "workflow",
        workflow: "portfolio_builder",
        entities: { symbols: [], budget: 10_000 },
        slots: {
          budget: { value: 10_000, source: "user", confidence: "high" },
        },
        preference_updates: [],
        missing_required: [],
        reasoning: "",
      };
      openCandleExtension(fake.api, {
        routerLlmClient: { complete: async () => JSON.stringify(workflowOutput) },
        stateDatabaseFactory,
      });
      await initMemory(fake);

      const inputHandler = fake.handlers.get("input")?.[0];
      const ctx = {
        isIdle: () => true,
        ui: { notify: vi.fn() },
        model: { id: "m" },
        sessionManager: { getBranch: () => [], getSessionId: () => "sid" },
      };

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

    it("injects memory context into system prompt after router preference writes", async () => {
      const fake = createFakeApi();
      const fallbackOutput = {
        route: "fallback",
        entities: { symbols: [] },
        slots: {},
        preference_updates: [
          { key: "risk_profile", value: "conservative", confidence: "high", source: "inferred" },
        ],
        missing_required: [],
        reasoning: "",
      };
      openCandleExtension(fake.api, {
        routerLlmClient: { complete: async () => JSON.stringify(fallbackOutput) },
        stateDatabaseFactory,
      });
      await initMemory(fake);

      // Store a preference via a routed turn
      const inputHandler = fake.handlers.get("input")?.[0];
      const ctx = {
        isIdle: () => true,
        ui: { notify: vi.fn() },
        model: { id: "m" },
        sessionManager: { getBranch: () => [], getSessionId: () => "sid" },
      };
      await inputHandler!({ type: "input", text: "I'm conservative", source: "interactive" }, ctx);

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
    expect(firstResult).toEqual({
      action: "transform",
      text: comprehensiveAnalysisPrompts("NVDA")[0],
    });
    expect(secondResult).toEqual({
      action: "transform",
      text: comprehensiveAnalysisPrompts("AAPL")[0],
    });
    // The NVDA follow-ups should have been cancelled
    expect(calls).not.toContain(comprehensiveAnalysisPrompts("NVDA")[1]);
    // The AAPL follow-ups should proceed
    expect(calls).toContain(comprehensiveAnalysisPrompts("AAPL")[1]);
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

    it.each(["length", "error", "aborted"] as const)(
      "restores the pre-route active tools after a terminal %s turn",
      async (stopReason) => {
        vi.stubEnv("OPENCANDLE_TOOL_SCOPE_MODE", "enforce");
        resetConfigCache();
        const fake = createFakeApi();
        const baselineTools = ["get_stock_quote", "get_crypto_price"];
        (fake.api.getAllTools as ReturnType<typeof vi.fn>).mockReturnValue(
          getOpenCandleToolDefinitions(),
        );
        (fake.api.getActiveTools as ReturnType<typeof vi.fn>).mockReturnValue(baselineTools);
        openCandleExtension(fake.api, { routerLlmClient: mockClient(fallbackOutput) });

        const inputHandler = fake.handlers.get("input")?.[0];
        await inputHandler!(
          { type: "input", text: "What is happening with ASTS?", source: "interactive" },
          {
            isIdle: () => true,
            ui: { notify: vi.fn() },
            model: { id: "m" },
            sessionManager: emptySessionManager,
          },
        );

        expect(fake.api.setActiveTools).toHaveBeenCalled();
        const turnEndHandler = fake.handlers.get("turn_end")?.[0];
        await turnEndHandler!(
          {
            type: "turn_end",
            turnIndex: 0,
            message: { role: "assistant", content: [], stopReason },
            toolResults: [],
          },
          {},
        );

        expect(fake.api.setActiveTools).toHaveBeenLastCalledWith(baselineTools);
      },
    );

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

      const beforeAgentStart = fake.handlers.get("before_agent_start")?.[0];
      const promptResult = await beforeAgentStart!(
        { type: "before_agent_start", prompt: "test", systemPrompt: "BASE" },
        {},
      );
      expect(promptResult.systemPrompt).toContain("Fallback Playbook");
      expect(promptResult.systemPrompt).toContain(
        "ticker preflight left fewer than two valid symbols",
      );
      expect(promptResult.systemPrompt).not.toContain("compare_assets");
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
        {
          type: "input",
          text: "Give me entry levels on ASTS for a 6 month horizon",
          source: "interactive",
        },
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

      await inputHandler!({ type: "input", text: "maybe aggressive", source: "interactive" }, ctx);

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

    it("prompts for external-tool setup and persists always-skip choices", async () => {
      const home = mkdtempSync(join(tmpdir(), "opencandle-external-tool-"));
      vi.stubEnv("OPENCANDLE_HOME", home);
      const askUserHandler = vi.fn().mockResolvedValue({ answer: "Always skip Reddit" });
      const fake = createFakeApi();
      openCandleExtension(fake.api, { askUserHandler });

      const toolResultHandler = fake.handlers.get("tool_result")?.[0];
      expect(toolResultHandler).toBeDefined();

      const result = await toolResultHandler!(
        toolResultEvent(
          '[OPENCANDLE_EXTERNAL_TOOL_REQUIRED provider=reddit reason=not_installed installCmd="uv tool install rdt-cli" fallback=twitter-web-news loginCmd="rdt login"]',
        ),
        { ui: { notify: vi.fn() } },
      );

      expect(askUserHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          question: expect.stringContaining("Install command: uv tool install rdt-cli."),
          options: ["Continue after installing Reddit", "Skip Reddit once", "Always skip Reddit"],
        }),
      );
      expect(result?.content[0]?.text).toContain("[OPENCANDLE_SKIPPED provider=reddit");
      expect(result?.content[0]?.text).toContain("silenced=true");
      expect(loadOnboardingState().providers.reddit?.status).toBe("never_ask");

      rmSync(home, { recursive: true, force: true });
    });

    it("gives hosted users provider-settings instructions instead of a dead connect flow", async () => {
      const home = mkdtempSync(join(tmpdir(), "opencandle-hosted-provider-"));
      vi.stubEnv("OPENCANDLE_HOME", home);
      const askUserHandler = vi
        .fn()
        .mockResolvedValue({ answer: "Show provider setup instructions" });
      const fake = createFakeApi();
      openCandleExtension(fake.api, { askUserHandler });
      const toolResultHandler = fake.handlers.get("tool_result")?.[0];
      const input = vi.fn();

      const result = await toolResultHandler!(
        toolResultEvent(
          '[OPENCANDLE_CREDENTIAL_REQUIRED provider=alpha_vantage reason=missing unlocks="fundamentals" fallback=none]',
        ),
        { hasUI: false, ui: { input, notify: vi.fn() } },
      );

      expect(askUserHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.arrayContaining(["Show provider setup instructions"]),
        }),
      );
      expect(input).not.toHaveBeenCalled();
      expect(result?.content[0]?.text).toContain("Providers settings");
      rmSync(home, { recursive: true, force: true });
    });

    it("keeps inline provider connection available in an interactive Pi UI", async () => {
      const home = mkdtempSync(join(tmpdir(), "opencandle-interactive-provider-"));
      vi.stubEnv("OPENCANDLE_HOME", home);
      const askUserHandler = vi
        .fn()
        .mockResolvedValue({ answer: "Continue without Alpha Vantage for this run" });
      const fake = createFakeApi();
      openCandleExtension(fake.api, { askUserHandler });
      const toolResultHandler = fake.handlers.get("tool_result")?.[0];

      await toolResultHandler!(
        toolResultEvent(
          '[OPENCANDLE_CREDENTIAL_REQUIRED provider=alpha_vantage reason=missing unlocks="fundamentals" fallback=none]',
        ),
        { hasUI: true, ui: { input: vi.fn(), notify: vi.fn() } },
      );

      expect(askUserHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.arrayContaining([expect.stringMatching(/^Connect now/)]),
        }),
      );
      rmSync(home, { recursive: true, force: true });
    });

    it("uses the requested external-tool provider in continue responses", async () => {
      const home = mkdtempSync(join(tmpdir(), "opencandle-external-tool-"));
      vi.stubEnv("OPENCANDLE_HOME", home);
      const askUserHandler = vi
        .fn()
        .mockResolvedValue({ answer: "Continue after logging in to X/Twitter" });
      const fake = createFakeApi();
      openCandleExtension(fake.api, { askUserHandler });

      const toolResultHandler = fake.handlers.get("tool_result")?.[0];
      expect(toolResultHandler).toBeDefined();

      const result = await toolResultHandler!(
        toolResultEvent(
          '[OPENCANDLE_EXTERNAL_TOOL_REQUIRED provider=twitter reason=session_missing installCmd="uv tool install twitter-cli" fallback=reddit-web-news loginCmd="log into x.com in a supported browser"]',
        ),
        { ui: { notify: vi.fn() } },
      );

      expect(result?.content[0]?.text).toContain("[OPENCANDLE_CONNECTED provider=twitter]");
      expect(result?.content[0]?.text).toContain("Re-run the original X / Twitter request now");
      expect(result?.content[0]?.text).not.toContain("Reddit sentiment request");

      rmSync(home, { recursive: true, force: true });
    });

    it("honors saved always-skip choices before prompting for external tools", async () => {
      const home = mkdtempSync(join(tmpdir(), "opencandle-external-tool-"));
      vi.stubEnv("OPENCANDLE_HOME", home);
      saveOnboardingState(markProviderNeverAsk({ version: 2, providers: {} }, "reddit"));
      const askUserHandler = vi.fn();
      const fake = createFakeApi();
      openCandleExtension(fake.api, { askUserHandler });

      const toolResultHandler = fake.handlers.get("tool_result")?.[0];
      expect(toolResultHandler).toBeDefined();

      const result = await toolResultHandler!(
        toolResultEvent(
          '[OPENCANDLE_EXTERNAL_TOOL_REQUIRED provider=reddit reason=not_installed installCmd="uv tool install rdt-cli" fallback=twitter-web-news loginCmd="rdt login"]',
        ),
        { ui: { notify: vi.fn() } },
      );

      expect(askUserHandler).not.toHaveBeenCalled();
      expect(result?.content[0]?.text).toContain("[OPENCANDLE_SKIPPED provider=reddit");
      expect(result?.content[0]?.text).toContain("silenced=true");
      expect(result?.content[0]?.text).toContain("previously asked not to be reminded");

      rmSync(home, { recursive: true, force: true });
    });
  });

  describe("llm session titles", () => {
    function chatBranch(userText = "what does a covered call actually do") {
      return [
        { type: "message", message: { role: "user", content: userText } },
        {
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "A covered call sells upside above the strike..." }],
            stopReason: "stop",
          },
        },
      ];
    }

    function titleCtx(branch: unknown[]) {
      return {
        hasUI: false,
        ui: { notify: vi.fn() },
        sessionManager: {
          getSessionId: () => "title-session",
          getBranch: () => branch,
        },
      };
    }

    const finalAssistantTurnEnd = {
      type: "turn_end",
      turnIndex: 0,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "A covered call sells upside above the strike..." }],
        stopReason: "stop",
      },
      toolResults: [],
    };

    async function fireTurnEnd(fake: ReturnType<typeof createFakeApi>, ctx: unknown) {
      for (const handler of fake.handlers.get("turn_end") ?? []) {
        await handler(finalAssistantTurnEnd, ctx);
      }
    }

    it("sets a summarized session name after the first completed exchange", async () => {
      const fake = createFakeApi();
      const titleCompletion = vi.fn(async () => "Covered Call Mechanics Explained");
      openCandleExtension(fake.api, { titleCompletion });

      const ctx = titleCtx(chatBranch());
      await fake.handlers.get("session_start")![0]!({ type: "session_start" }, ctx);
      await fireTurnEnd(fake, ctx);

      expect(titleCompletion).toHaveBeenCalledTimes(1);
      expect(titleCompletion.mock.calls[0]![0]).toContain("what does a covered call actually do");
      expect(fake.api.setSessionName).toHaveBeenCalledWith("Covered Call Mechanics Explained");
    });

    it("prefers the opencandle-user-input original over the expanded first user message", async () => {
      const fake = createFakeApi();
      const titleCompletion = vi.fn(async () => "Nvidia Deep Dive Session");
      openCandleExtension(fake.api, { titleCompletion });

      const branch = [
        {
          type: "custom",
          customType: "opencandle-user-input",
          data: { original: "analyze NVDA" },
        },
        { type: "message", message: { role: "user", content: "Expanded workflow prompt..." } },
        {
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "NVDA analysis..." }],
            stopReason: "stop",
          },
        },
      ];
      const ctx = titleCtx(branch);
      await fake.handlers.get("session_start")![0]!({ type: "session_start" }, ctx);
      await fireTurnEnd(fake, ctx);

      expect(titleCompletion.mock.calls[0]![0]).toContain("analyze NVDA");
      expect(titleCompletion.mock.calls[0]![0]).not.toContain("Expanded workflow prompt");
      expect(fake.api.setSessionName).toHaveBeenCalledWith("Nvidia Deep Dive Session");
    });

    it("titles a session at most once per process", async () => {
      const fake = createFakeApi();
      const titleCompletion = vi.fn(async () => "Covered Call Mechanics Explained");
      openCandleExtension(fake.api, { titleCompletion });

      const ctx = titleCtx(chatBranch());
      await fake.handlers.get("session_start")![0]!({ type: "session_start" }, ctx);
      await fireTurnEnd(fake, ctx);
      await fireTurnEnd(fake, ctx);

      expect(titleCompletion).toHaveBeenCalledTimes(1);
      expect(fake.api.setSessionName).toHaveBeenCalledTimes(1);
    });

    it("leaves manually renamed sessions alone", async () => {
      const fake = createFakeApi();
      const titleCompletion = vi.fn(async () => "Covered Call Mechanics Explained");
      (fake.api.getSessionName as ReturnType<typeof vi.fn>).mockReturnValue("My research notes");
      openCandleExtension(fake.api, { titleCompletion });

      const ctx = titleCtx(chatBranch());
      await fake.handlers.get("session_start")![0]!({ type: "session_start" }, ctx);
      await fireTurnEnd(fake, ctx);

      expect(titleCompletion).not.toHaveBeenCalled();
      expect(fake.api.setSessionName).not.toHaveBeenCalled();
    });

    it("still titles when the current name is the raw first-prompt placeholder", async () => {
      const fake = createFakeApi();
      const titleCompletion = vi.fn(async () => "Covered Call Mechanics Explained");
      (fake.api.getSessionName as ReturnType<typeof vi.fn>).mockReturnValue(
        "what does a covered call actually do",
      );
      openCandleExtension(fake.api, { titleCompletion });

      const ctx = titleCtx(chatBranch());
      await fake.handlers.get("session_start")![0]!({ type: "session_start" }, ctx);
      await fireTurnEnd(fake, ctx);

      expect(fake.api.setSessionName).toHaveBeenCalledWith("Covered Call Mechanics Explained");
    });

    it("records an observability entry and keeps the placeholder on model failure", async () => {
      const fake = createFakeApi();
      const titleCompletion = vi.fn(async () => {
        throw new Error("model unavailable");
      });
      openCandleExtension(fake.api, { titleCompletion });

      const ctx = titleCtx(chatBranch());
      await fake.handlers.get("session_start")![0]!({ type: "session_start" }, ctx);
      await fireTurnEnd(fake, ctx);

      expect(fake.api.setSessionName).not.toHaveBeenCalled();
      const errorEntry = (fake.api.appendEntry as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === "opencandle-title-error",
      );
      expect(errorEntry).toBeDefined();
      expect((errorEntry![1] as { message: string }).message).toContain("model unavailable");
    });
  });
});
