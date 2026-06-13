import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDefaultDatabase } from "../../../src/memory/sqlite.js";
import { buildResolvedTurnContext } from "../../../src/routing/turn-context.js";
import type { WorkflowDefinition } from "../../../src/runtime/prompt-step.js";
import { ProviderTracker } from "../../../src/runtime/provider-tracker.js";
import {
  clearRunContext,
  getProviderTracker,
  setRunContext,
} from "../../../src/runtime/run-context.js";
import { SessionCoordinator } from "../../../src/runtime/session-coordinator.js";

type ReadonlySessionManager = ExtensionContext["sessionManager"];

/**
 * Build a fake `ReadonlySessionManager` whose `getBranch()` returns the given
 * entries in root→leaf order. Only `getBranch` is used by `buildPriorTurns`;
 * the other methods throw so misuse is loud.
 */
function fakeSessionManager(entries: SessionEntry[]): ReadonlySessionManager {
  return {
    getBranch: () => entries,
    getCwd: () => "/tmp",
    getSessionDir: () => "/tmp",
    getSessionId: () => "test-session",
    getSessionFile: () => undefined,
    getLeafId: () => entries[entries.length - 1]?.id ?? null,
    getLeafEntry: () => entries[entries.length - 1],
    getEntry: (id: string) => entries.find((e) => e.id === id),
    getLabel: () => undefined,
    getHeader: () => null,
    getEntries: () => entries,
    getTree: () => [],
    getSessionName: () => undefined,
  } as unknown as ReadonlySessionManager;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `e${idCounter}`;
}

function userTextEntry(text: string): SessionEntry {
  return {
    type: "message",
    id: nextId(),
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    },
  } as SessionEntry;
}

function userStringEntry(text: string): SessionEntry {
  return {
    type: "message",
    id: nextId(),
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content: text,
      timestamp: Date.now(),
    },
  } as SessionEntry;
}

function assistantTextEntry(text: string): SessionEntry {
  return {
    type: "message",
    id: nextId(),
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "anthropic",
      provider: "anthropic",
      model: "claude-test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    },
  } as SessionEntry;
}

/** Assistant message with a text block AND a tool-call block. */
function assistantMixedEntry(text: string, toolName: string): SessionEntry {
  return {
    type: "message",
    id: nextId(),
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: [
        { type: "text", text },
        { type: "toolCall", id: "tc-1", name: toolName, arguments: {} },
      ],
      api: "anthropic",
      provider: "anthropic",
      model: "claude-test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    },
  } as SessionEntry;
}

/** Assistant message with only tool-call blocks (no text). */
function assistantToolOnlyEntry(toolName: string): SessionEntry {
  return {
    type: "message",
    id: nextId(),
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: "tc-1", name: toolName, arguments: {} }],
      api: "anthropic",
      provider: "anthropic",
      model: "claude-test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: Date.now(),
    },
  } as SessionEntry;
}

/** Aborted assistant turn: empty content array. */
function assistantEmptyEntry(): SessionEntry {
  return {
    type: "message",
    id: nextId(),
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: [],
      api: "anthropic",
      provider: "anthropic",
      model: "claude-test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "aborted",
      timestamp: Date.now(),
    },
  } as SessionEntry;
}

function toolResultEntry(text: string): SessionEntry {
  return {
    type: "message",
    id: nextId(),
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "toolResult",
      toolCallId: "tc-1",
      toolName: "get_stock_quote",
      content: [{ type: "text", text }],
      isError: false,
      timestamp: Date.now(),
    },
  } as SessionEntry;
}

function compactionEntry(summary: string): SessionEntry {
  return {
    type: "compaction",
    id: nextId(),
    parentId: null,
    timestamp: new Date().toISOString(),
    summary,
    firstKeptEntryId: "xxx",
    tokensBefore: 1000,
  } as SessionEntry;
}

function branchSummaryEntry(summary: string): SessionEntry {
  return {
    type: "branch_summary",
    id: nextId(),
    parentId: null,
    timestamp: new Date().toISOString(),
    fromId: "xxx",
    summary,
  } as SessionEntry;
}

function workflowDefinition(name: string): WorkflowDefinition {
  return {
    workflowType: name,
    steps: [
      {
        stepType: "first",
        description: "first step",
        prompt: `${name} first prompt`,
        skippable: false,
        requiredInputs: [],
        expectedOutputs: [],
      },
    ],
  };
}

function fakeQueueContext(isIdle: () => boolean) {
  return {
    isIdle,
    hasPendingMessages: () => false,
    ui: { notify: vi.fn() },
  };
}

afterEach(() => {
  vi.useRealTimers();
  clearRunContext();
});

describe("SessionCoordinator workflow runtime ownership", () => {
  it("exposes the active workflow type so workflow turns can carry saved market state", () => {
    const coord = new SessionCoordinator();
    const pi = { sendUserMessage: vi.fn(), appendEntry: vi.fn() };

    expect(coord.getActiveWorkflowType()).toBeUndefined();

    coord.transformWorkflowInput(
      pi as never,
      workflowDefinition("options_screener"),
      fakeQueueContext(() => true),
    );

    expect(coord.getActiveWorkflowType()).toBe("options_screener");
  });

  it("does not clear an unowned run context when no workflow is active", () => {
    const coord = new SessionCoordinator();
    const tracker = new ProviderTracker();

    setRunContext({ providerTracker: tracker });

    coord.cancelActiveWorkflow();

    expect(getProviderTracker()).toBe(tracker);
  });

  it("does not let a superseded workflow clear the newer workflow context", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const pi = { sendUserMessage: vi.fn() };

    let oldWorkflowIdle = false;
    coord.executeWorkflow(
      pi as never,
      workflowDefinition("old"),
      fakeQueueContext(() => oldWorkflowIdle),
    );

    coord.executeWorkflow(
      pi as never,
      workflowDefinition("new"),
      fakeQueueContext(() => false),
    );

    const newTracker = getProviderTracker();
    expect(newTracker).toBeDefined();

    oldWorkflowIdle = true;
    await vi.advanceTimersByTimeAsync(26);

    expect(getProviderTracker()).toBe(newTracker);
  });
});

describe("SessionCoordinator.buildPriorTurns", () => {
  it("returns empty array for an empty branch", () => {
    const coord = new SessionCoordinator();
    const turns = coord.buildPriorTurns(fakeSessionManager([]));
    expect(turns).toEqual([]);
  });

  it("returns a single user message when the branch has only one", () => {
    const coord = new SessionCoordinator();
    const turns = coord.buildPriorTurns(fakeSessionManager([userTextEntry("tell me about NVDA")]));
    expect(turns).toEqual([{ role: "user", text: "tell me about NVDA" }]);
  });

  it("accepts user messages with plain-string content", () => {
    const coord = new SessionCoordinator();
    const turns = coord.buildPriorTurns(fakeSessionManager([userStringEntry("hello world")]));
    expect(turns).toEqual([{ role: "user", text: "hello world" }]);
  });

  it("excludes tool-result messages from priorTurns", () => {
    const coord = new SessionCoordinator();
    const turns = coord.buildPriorTurns(
      fakeSessionManager([
        userTextEntry("analyze NVDA"),
        toolResultEntry('{"price": 500}'),
        assistantTextEntry("NVDA looks strong."),
      ]),
    );
    expect(turns).toEqual([
      { role: "user", text: "analyze NVDA" },
      { role: "assistant", text: "NVDA looks strong." },
    ]);
  });

  it("excludes aborted assistant turns with no text content", () => {
    const coord = new SessionCoordinator();
    const turns = coord.buildPriorTurns(
      fakeSessionManager([userTextEntry("run the analysis"), assistantEmptyEntry()]),
    );
    expect(turns).toEqual([{ role: "user", text: "run the analysis" }]);
  });

  it("excludes assistant turns that contain only tool-call blocks (no text)", () => {
    const coord = new SessionCoordinator();
    const turns = coord.buildPriorTurns(
      fakeSessionManager([
        userTextEntry("quote NVDA"),
        assistantToolOnlyEntry("get_stock_quote"),
        assistantTextEntry("NVDA is at $500."),
      ]),
    );
    expect(turns).toEqual([
      { role: "user", text: "quote NVDA" },
      { role: "assistant", text: "NVDA is at $500." },
    ]);
  });

  it("keeps assistant mixed-content messages using only their text blocks", () => {
    const coord = new SessionCoordinator();
    const turns = coord.buildPriorTurns(
      fakeSessionManager([
        userTextEntry("fetch it"),
        assistantMixedEntry("Fetching now.", "get_stock_quote"),
      ]),
    );
    expect(turns).toEqual([
      { role: "user", text: "fetch it" },
      { role: "assistant", text: "Fetching now." },
    ]);
  });

  it("skips compaction and branch_summary entries between root and leaf", () => {
    const coord = new SessionCoordinator();
    const turns = coord.buildPriorTurns(
      fakeSessionManager([
        userTextEntry("turn 1"),
        assistantTextEntry("reply 1"),
        compactionEntry("summary of prior conversation"),
        branchSummaryEntry("abandoned branch summary"),
        userTextEntry("turn 2"),
        assistantTextEntry("reply 2"),
      ]),
    );
    // Compaction + branch_summary contribute nothing — no synthesized messages.
    expect(turns).toEqual([
      { role: "user", text: "turn 1" },
      { role: "assistant", text: "reply 1" },
      { role: "user", text: "turn 2" },
      { role: "assistant", text: "reply 2" },
    ]);
  });

  it("slices to the last 5 qualifying entries when the branch has more", () => {
    const coord = new SessionCoordinator();
    const turns = coord.buildPriorTurns(
      fakeSessionManager([
        userTextEntry("u1"),
        assistantTextEntry("a1"),
        userTextEntry("u2"),
        assistantTextEntry("a2"),
        userTextEntry("u3"),
        assistantTextEntry("a3"),
        userTextEntry("u4"),
      ]),
    );
    // 7 qualifying entries → keep the last 5; u1 and a1 are dropped.
    expect(turns).toHaveLength(5);
    expect(turns).toEqual([
      { role: "user", text: "u2" },
      { role: "assistant", text: "a2" },
      { role: "user", text: "u3" },
      { role: "assistant", text: "a3" },
      { role: "user", text: "u4" },
    ]);
  });

  it("orders entries oldest → newest, matching getBranch root→leaf order", () => {
    const coord = new SessionCoordinator();
    const turns = coord.buildPriorTurns(
      fakeSessionManager([
        userTextEntry("first"),
        assistantTextEntry("second"),
        userTextEntry("third"),
      ]),
    );
    expect(turns.map((t) => t.text)).toEqual(["first", "second", "third"]);
  });

  it("respects a custom max parameter", () => {
    const coord = new SessionCoordinator();
    const turns = coord.buildPriorTurns(
      fakeSessionManager([userTextEntry("one"), userTextEntry("two"), userTextEntry("three")]),
      2,
    );
    expect(turns.map((t) => t.text)).toEqual(["two", "three"]);
  });
});

describe("SessionCoordinator.buildRouterContextBase", () => {
  it("includes priorTurns alongside profile + recent runs", () => {
    const coord = new SessionCoordinator();
    const mgr = fakeSessionManager([userTextEntry("hello"), assistantTextEntry("hi")]);
    const ctx = coord.buildRouterContextBase(mgr);
    expect(ctx.priorTurns).toEqual([
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi" },
    ]);
    expect(ctx.profileSnapshot).toEqual({});
    expect(ctx.recentWorkflowRuns).toEqual([]);
  });
});

describe("SessionCoordinator.buildSystemPrompt saved market state", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  let openCandleHome: string | null = null;

  afterEach(() => {
    if (originalEnv == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalEnv;
    }
    if (openCandleHome) {
      rmSync(openCandleHome, { recursive: true, force: true });
      openCandleHome = null;
    }
  });

  it("includes portfolio, watchlist, alerts, reports, and predictions in prompt context", () => {
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-market-state-context-"));
    process.env.OPENCANDLE_HOME = openCandleHome;

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    const asts = {
      symbol: "ASTS",
      assetType: "equity",
      name: "AST SpaceMobile, Inc.",
      exchange: "NMS",
      currency: "USD",
      provider: "yahoo",
    };
    const item = service.addWatchlistItem({
      instrument: asts,
      targetPrice: 55,
      stopPrice: 22,
      thesis: "Space-based broadband satellite network",
      notes: "Watch launch cadence and carrier partnerships",
      tags: ["space", "satellite"],
    });
    service.addPortfolioLot({
      instrument: asts,
      quantity: 40,
      avgCost: 28,
      currency: "USD",
    });
    service.createAlertRule({
      scopeType: "instrument",
      instrumentId: item.instrumentId,
      conditionType: "price_crosses_above",
      conditionVersion: 1,
      condition: { threshold: 55, field: "last_price" },
      timeframe: "quote",
      cooldownSeconds: 3600,
    });
    const template = service.createReportTemplate({
      name: "Morning watchlist",
      reportType: "watchlist_daily",
      cadence: "daily",
      timezone: "America/Toronto",
      localTime: "08:00",
      config: { targets: { default_watchlist: true } },
      enabled: true,
    });
    service.recordReportRun({
      templateId: template.id,
      status: "completed",
      summary: { symbols: ["ASTS"] },
      errors: [],
    });
    service.recordPrediction({
      instrument: asts,
      direction: "bullish",
      conviction: 8,
      entryPrice: 30,
      targetPrice: 60,
      timeframeDays: 60,
    });
    db.close();

    const coord = new SessionCoordinator();
    coord.initSession("test-session");
    const prompt = coord.buildSystemPrompt(
      "base",
      undefined,
      undefined,
      resolvedTurnContext("agent_task"),
    );

    expect(prompt).toContain("Saved Market State");
    expect(prompt).toContain("ASTS");
    expect(prompt).toContain("40 @ $28.00");
    expect(prompt).toContain("cost basis $1120.00");
    expect(prompt).toContain("explicitly mention the saved quantity, average cost, and cost basis");
    expect(prompt).toContain("target $55.00");
    expect(prompt).toContain("price_crosses_above");
    expect(prompt).toContain("Morning watchlist");
    expect(prompt).toContain("bullish conv 8/10");
    expect(prompt).toContain("space, satellite");
  });

  it("does not inject saved market state into unrelated prompts without route context", () => {
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-market-state-context-"));
    process.env.OPENCANDLE_HOME = openCandleHome;

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    service.addPortfolioLot({
      instrument: {
        symbol: "ASTS",
        assetType: "equity",
        name: "AST SpaceMobile, Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
      quantity: 40,
      avgCost: 28,
      currency: "USD",
    });
    db.close();

    const coord = new SessionCoordinator();
    coord.initSession("test-session");

    expect(coord.buildSystemPrompt("base")).not.toContain("Saved Market State");
    expect(
      coord.buildSystemPrompt("base", undefined, undefined, resolvedTurnContext("pass_through")),
    ).not.toContain("Saved Market State");
  });

  it("injects saved market state for rules-mode finance fallback turns carrying a fallback context", () => {
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-market-state-context-"));
    process.env.OPENCANDLE_HOME = openCandleHome;

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    service.addPortfolioLot({
      instrument: {
        symbol: "RKLB",
        assetType: "equity",
        name: "Rocket Lab USA, Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
      quantity: 150,
      avgCost: 18.4,
      currency: "USD",
    });
    db.close();

    const coord = new SessionCoordinator();
    coord.initSession("test-session");
    const prompt = coord.buildSystemPrompt("base", undefined, {
      assumptionsBlock: "",
      missingRequired: [],
      extraContext: "General finance question without a dispatched workflow.",
    });

    expect(prompt).toContain("Saved Market State");
    expect(prompt).toContain("RKLB");
  });
});

function resolvedTurnContext(routeKind: "agent_task" | "pass_through") {
  return buildResolvedTurnContext(
    {
      text: routeKind === "pass_through" ? "write a poem" : "how does space sector news affect me?",
      priorTurns: [],
      profileSnapshot: {},
      recentWorkflowRuns: [],
    },
    {
      routeKind,
      route: "fallback",
      workflow: routeKind === "pass_through" ? undefined : "general_finance_qa",
      entities: { symbols: [] },
      slots: {},
      preference_updates: [],
      missing_required: [],
      tool_bundles: [],
      diagnostics: [],
      reasoning: "test context",
    },
  );
}
