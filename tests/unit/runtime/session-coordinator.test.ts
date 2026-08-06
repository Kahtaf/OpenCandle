import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDatabase, initDefaultDatabase } from "../../../src/memory/sqlite.js";
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

function multiStepWorkflowDefinition(): WorkflowDefinition {
  return {
    workflowType: "comprehensive_analysis",
    steps: [
      {
        stepType: "initial_fetch",
        description: "fetch step",
        prompt: "fetch prompt",
        skippable: false,
        requiredInputs: [],
        expectedOutputs: [],
      },
      {
        stepType: "analyst_valuation",
        description: "valuation step",
        prompt: "valuation prompt",
        skippable: true,
        requiredInputs: [],
        expectedOutputs: [],
      },
    ],
  };
}

function analystWorkflowDefinition(): WorkflowDefinition {
  return {
    workflowType: "comprehensive_analysis",
    steps: [
      {
        stepType: "analyst_valuation",
        description: "valuation step",
        prompt: "valuation prompt",
        skippable: true,
        requiredInputs: [],
        expectedOutputs: [],
      },
    ],
  };
}

function debateWorkflowDefinition(): WorkflowDefinition {
  return {
    workflowType: "comprehensive_analysis",
    steps: [
      {
        stepType: "debate_bull",
        description: "bull debate step",
        prompt: "bull prompt",
        skippable: false,
        requiredInputs: [],
        expectedOutputs: [],
      },
    ],
  };
}

function deterministicWorkflowDefinition(): WorkflowDefinition {
  const analystStep = (stepType: string, prompt: string): WorkflowDefinition["steps"][number] => ({
    stepType,
    description: stepType,
    prompt,
    skippable: true,
    requiredInputs: [],
    expectedOutputs: [],
  });

  return {
    workflowType: "comprehensive_analysis",
    steps: [
      analystStep("analyst_valuation", "valuation prompt"),
      analystStep("analyst_momentum", "momentum prompt"),
      {
        stepType: "debate_bull",
        description: "bull debate step",
        prompt: "bull prompt",
        skippable: false,
        requiredInputs: [],
        expectedOutputs: [],
      },
      {
        stepType: "debate_bear",
        description: "bear debate step",
        prompt: "bear prompt",
        skippable: false,
        requiredInputs: [],
        expectedOutputs: [],
      },
      {
        stepType: "debate_rebuttal",
        description: "rebuttal step",
        prompt: "rebuttal prompt",
        skippable: true,
        requiredInputs: [],
        expectedOutputs: [],
      },
      {
        stepType: "synthesis",
        description: "synthesis step",
        prompt: "synthesis prompt",
        skippable: false,
        requiredInputs: [],
        expectedOutputs: [],
      },
    ],
  };
}

function fakeQueueContext(isIdle: () => boolean, entries: SessionEntry[] = []) {
  return {
    isIdle,
    hasPendingMessages: () => false,
    ui: { notify: vi.fn() },
    sessionManager: fakeSessionManager(entries),
  };
}

afterEach(() => {
  vi.useRealTimers();
  clearRunContext();
});

describe("SessionCoordinator runtime composition", () => {
  it("builds prompt capability context from injected runtime factories", () => {
    const coord = new SessionCoordinator({
      addonToolDescriptionsFactory: () => [
        {
          name: "get_browser_quote",
          description: "Fetch a quote from a browser-safe provider.",
        },
      ],
      toolDefaultsFactory: () =>
        new Map([
          [
            "get_browser_quote",
            {
              currency: "USD",
              nested: { timeframe: "1d" },
              __enabled: true,
            },
          ],
        ]),
    });

    const prompt = coord.buildSystemPrompt("base");

    expect(prompt).toContain("get_browser_quote: Fetch a quote from a browser-safe provider.");
    expect(prompt).toContain("currency: USD");
    expect(prompt).toContain("nested.timeframe: 1d");
    expect(prompt).not.toContain("__enabled");
  });

  it("initializes persistence through an injected StateDatabase factory", () => {
    const database = initDatabase(":memory:");
    const stateDatabaseFactory = vi.fn(() => database);
    const coord = new SessionCoordinator({
      stateDatabaseFactory,
    });

    coord.initSession("browser-session");

    expect(stateDatabaseFactory).toHaveBeenCalledOnce();
    expect(coord.getStorage()).not.toBeNull();
    database.close();
  });

  it("supports an intentionally ephemeral runtime composition", () => {
    const coord = new SessionCoordinator({
      stateDatabaseFactory: () => null,
    });

    coord.initSession("ephemeral-session");

    expect(coord.getStorage()).toBeNull();
    expect(coord.getRunner()).toBeDefined();
  });
});

describe("SessionCoordinator workflow runtime ownership", () => {
  it("finishes a workflow when the terminal assistant response is recorded before the queue reports idle", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    let sendCount = 0;
    const pi = {
      sendUserMessage: vi.fn((prompt: string) => {
        sendCount += 1;
        const currentSend = sendCount;
        entries.push(userTextEntry(prompt));
        setTimeout(() => {
          entries.push(
            assistantTextEntry(
              currentSend === 1
                ? "workflow response"
                : "Valuation complete.\nSIGNAL: HOLD\nCONVICTION: 5\nTHESIS: Evidence is balanced.",
            ),
          );
        }, 10);
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(
      pi as never,
      multiStepWorkflowDefinition(),
      fakeQueueContext(() => false, entries),
    );

    let completed = false;
    const completion = coord.waitForActiveWorkflow().then(() => {
      completed = true;
    });

    await vi.advanceTimersByTimeAsync(500);

    expect(completed).toBe(true);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);
    expect(coord.getRunner().getActiveRun()?.status).toBe("completed");
    expect(pi.appendEntry).toHaveBeenCalledWith("opencandle-workflow-complete", {
      workflow: "comprehensive_analysis",
      status: "completed",
    });
    await completion;
  });

  it("does not crash the runtime when a completed workflow has a stale Pi context", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    const pi = {
      sendUserMessage: vi.fn((prompt: string) => {
        entries.push(userTextEntry(prompt));
        setTimeout(() => entries.push(assistantTextEntry("workflow response")), 10);
      }),
      appendEntry: vi.fn(() => {
        throw new Error("This extension ctx is stale after session replacement or reload.");
      }),
    };

    coord.executeWorkflow(
      pi as never,
      workflowDefinition("stale-context"),
      fakeQueueContext(() => false, entries),
    );

    await vi.advanceTimersByTimeAsync(500);
    await expect(coord.waitForActiveWorkflow()).resolves.toBeUndefined();
    expect(pi.appendEntry).toHaveBeenCalledWith("opencandle-workflow-complete", {
      workflow: "stale-context",
      status: "completed",
    });
  });

  it("fails a workflow instead of advancing after an aborted assistant response", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    const pi = {
      sendUserMessage: vi.fn((prompt: string) => {
        entries.push(userTextEntry(prompt));
        setTimeout(() => entries.push(assistantEmptyEntry()), 10);
        setTimeout(() => entries.push(userTextEntry("later unrelated question")), 15);
        setTimeout(() => entries.push(assistantTextEntry("later unrelated answer")), 20);
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(
      pi as never,
      multiStepWorkflowDefinition(),
      fakeQueueContext(() => false, entries),
    );

    await vi.advanceTimersByTimeAsync(100);
    await coord.waitForActiveWorkflow();

    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(coord.getRunner().getActiveRun()?.status).toBe("failed");
  });

  it("does not treat an older in-flight answer as the queued workflow response", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [userTextEntry("older question")];
    let sendCount = 0;
    const pi = {
      sendUserMessage: vi.fn((prompt: string) => {
        sendCount += 1;
        if (sendCount === 1) {
          setTimeout(() => entries.push(assistantTextEntry("older answer")), 10);
          setTimeout(() => entries.push(userTextEntry(prompt)), 30);
          setTimeout(() => entries.push(assistantTextEntry("workflow response")), 50);
          return;
        }
        entries.push(userTextEntry(prompt));
        setTimeout(
          () =>
            entries.push(
              assistantTextEntry(
                "Valuation complete.\nSIGNAL: HOLD\nCONVICTION: 5\nTHESIS: Evidence is balanced.",
              ),
            ),
          10,
        );
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(
      pi as never,
      multiStepWorkflowDefinition(),
      fakeQueueContext(() => false, entries),
    );
    const completion = coord.waitForActiveWorkflow();

    await vi.advanceTimersByTimeAsync(20);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    await completion;

    expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);
    expect(coord.getRunner().getActiveRun()?.status).toBe("completed");
  });

  it("waits for every coordinator-managed workflow prompt to settle", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    let sendCount = 0;
    const pi = {
      sendUserMessage: vi.fn((prompt: string) => {
        sendCount += 1;
        const currentSend = sendCount;
        entries.push(userTextEntry(prompt));
        setTimeout(
          () =>
            entries.push(
              assistantTextEntry(
                currentSend === 1
                  ? "workflow response"
                  : "Valuation complete.\nSIGNAL: HOLD\nCONVICTION: 5\nTHESIS: Evidence is balanced.",
              ),
            ),
          currentSend === 1 ? 10 : 60,
        );
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(
      pi as never,
      multiStepWorkflowDefinition(),
      fakeQueueContext(() => true, entries),
    );
    let completed = false;
    const completion = coord.waitForActiveWorkflow().then(() => {
      completed = true;
    });

    await vi.advanceTimersByTimeAsync(20);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await completion;

    expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);
    expect(coord.getRunner().getActiveRun()?.status).toBe("completed");
  });

  it("does not advance through queued workflow prompts before Pi observes each prompt", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    const definition: WorkflowDefinition = {
      workflowType: "queued-prompt-guard",
      steps: [
        {
          stepType: "one",
          description: "one",
          prompt: "one",
          skippable: false,
          requiredInputs: [],
          expectedOutputs: [],
        },
        {
          stepType: "two",
          description: "two",
          prompt: "two",
          skippable: false,
          requiredInputs: [],
          expectedOutputs: [],
        },
        {
          stepType: "three",
          description: "three",
          prompt: "three",
          skippable: false,
          requiredInputs: [],
          expectedOutputs: [],
        },
      ],
    };
    const pi = {
      sendUserMessage: vi.fn((prompt: string) => {
        setTimeout(() => entries.push(userTextEntry(prompt)), 300);
        setTimeout(() => entries.push(assistantTextEntry(`${prompt} response`)), 310);
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(pi as never, definition, {
      isIdle: () => true,
      hasPendingMessages: () => false,
      ui: { notify: vi.fn() },
      // Pi's public extension context exposes the read-only branch rather
      // than the hosted runtime's getEntries() helper.
      sessionManager: { getBranch: () => entries },
    });

    // The second prompt is accepted only after the first response. Its own
    // enqueue has not reached Pi yet, so a transient idle queue must not
    // cause the third prompt to be sent.
    await vi.advanceTimersByTimeAsync(450);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);

    coord.cancelActiveWorkflow();
  });

  it("settles a transformed first step from Pi's persisted original user input", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    const pi = {
      sendUserMessage: vi.fn((prompt: string) => {
        entries.push(userTextEntry(prompt));
        setTimeout(
          () =>
            entries.push(
              assistantTextEntry(
                "Valuation complete.\nSIGNAL: HOLD\nCONVICTION: 5\nTHESIS: Evidence is balanced.",
              ),
            ),
          10,
        );
      }),
      appendEntry: vi.fn(),
    };

    const transformed = coord.transformWorkflowInput(
      pi as never,
      multiStepWorkflowDefinition(),
      fakeQueueContext(() => true, entries),
    );
    entries.push(userTextEntry("/analyze AAPL"));
    setTimeout(() => entries.push(assistantTextEntry("first-stage response")), 10);

    expect(transformed).toBe("fetch prompt");
    await vi.advanceTimersByTimeAsync(200);
    await coord.waitForActiveWorkflow();

    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(coord.getRunner().getActiveRun()?.status).toBe("completed");
  });

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

  it("captures tool evidence from each workflow step without leaking between steps", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    let sendCount = 0;
    const pi = {
      sendUserMessage: vi.fn((prompt: string) => {
        sendCount += 1;
        const currentSend = sendCount;
        const stepCallId = `tc-${sendCount}`;
        const toolName = sendCount === 1 ? "get_stock_quote" : "get_company_overview";
        const symbol = sendCount === 1 ? "NVDA" : "AAPL";
        entries.push(userTextEntry(prompt));
        setTimeout(() => {
          entries.push(assistantToolOnlyEntry(toolName));
          const toolResult = toolResultEntry(`${symbol} result`);
          toolResult.message.toolCallId = stepCallId;
          toolResult.message.toolName = toolName;
          toolResult.message.details = { symbol, price: currentSend * 100 };
          entries.push(toolResult);
          entries.push(
            assistantTextEntry(
              currentSend === 1
                ? "step 1 done"
                : "step 2 done\nSIGNAL: HOLD\nCONVICTION: 5\nTHESIS: Evidence is balanced.",
            ),
          );
        }, 10);
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(
      pi as never,
      multiStepWorkflowDefinition(),
      fakeQueueContext(() => true, entries),
    );

    await vi.advanceTimersByTimeAsync(500);
    const run = coord.getRunner().getActiveRun();

    expect(run?.status).toBe("completed");
    expect(run?.stepOutputs.get(0)?.evidence).toHaveLength(1);
    expect(run?.stepOutputs.get(1)?.evidence).toHaveLength(1);
    expect(run?.stepOutputs.get(0)?.evidence[0]).toMatchObject({
      label: "tool:get_stock_quote",
      value: {
        tool: "get_stock_quote",
        args: "{}",
        resultDigest: { preview: expect.stringContaining("NVDA"), totalLength: expect.any(Number) },
      },
      provenance: { source: "computed", provider: "get_stock_quote" },
    });
    expect(run?.stepOutputs.get(1)?.evidence[0]).toMatchObject({
      label: "tool:get_company_overview",
      value: {
        tool: "get_company_overview",
        args: "{}",
        resultDigest: { preview: expect.stringContaining("AAPL"), totalLength: expect.any(Number) },
      },
      provenance: { source: "computed", provider: "get_company_overview" },
    });
  });

  it("captures streamed Pi tool evidence for structured analyst entries", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    type Handler = (event: never) => void;
    const handlers = new Map<string, Handler[]>();
    const emit = (name: string, event: unknown) => {
      for (const handler of handlers.get(name) ?? []) {
        handler(event as never);
      }
    };
    const pi = {
      on: vi.fn((name: string, handler: Handler) => {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      }),
      sendUserMessage: vi.fn(() => {
        entries.push(userTextEntry("valuation prompt"));
        setTimeout(() => {
          emit("tool_execution_start", {
            toolCallId: "tc-live",
            toolName: "get_stock_quote",
            args: { symbol: "NVDA" },
          });
          emit("tool_execution_end", {
            toolCallId: "tc-live",
            toolName: "get_stock_quote",
            result: {
              content: [{ type: "text", text: "NVDA quote" }],
              details: {
                symbol: "NVDA",
                price: 123,
                freshness: {
                  fetchedAt: "2026-07-05T19:00:00.000Z",
                  providerDataAt: "2026-07-02T20:00:00.000Z",
                  cacheStatus: "live",
                  marketSession: "closed_weekend",
                  isStaleForSession: false,
                },
              },
            },
            isError: false,
          });
          emit("message_update", {
            assistantMessageEvent: {
              type: "text_delta",
              delta:
                "Valuation work.\nSIGNAL: BUY\nCONVICTION: 8\nTHESIS: Revenue growth supports upside.",
            },
          });
          entries.push(
            assistantTextEntry(
              "Valuation work.\nSIGNAL: BUY\nCONVICTION: 8\nTHESIS: Revenue growth supports upside.",
            ),
          );
        }, 10);
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(
      pi as never,
      analystWorkflowDefinition(),
      fakeQueueContext(() => true, entries),
    );

    await vi.advanceTimersByTimeAsync(500);
    const output = coord.getRunner().getActiveRun()?.stepOutputs.get(0);

    expect(output?.evidence).toHaveLength(1);
    expect(output?.evidence[0]).toMatchObject({
      label: "tool:get_stock_quote",
      value: {
        tool: "get_stock_quote",
        args: '{"symbol":"NVDA"}',
        freshness: {
          fetchedAt: "2026-07-05T19:00:00.000Z",
          providerDataAt: "2026-07-02T20:00:00.000Z",
          cacheStatus: "live",
          marketSession: "closed_weekend",
          isStaleForSession: false,
        },
        resultDigest: {
          preview: expect.stringContaining('"symbol":"NVDA"'),
          totalLength: expect.any(Number),
        },
      },
      provenance: {
        timestamp: "2026-07-02T20:00:00.000Z",
      },
    });
    expect(output?.analystOutput?.signal).toBe("BUY");
    expect(pi.appendEntry).toHaveBeenCalledWith("opencandle-analyst-step", {
      stage: "analyst_valuation",
      role: "valuation",
      signal: "BUY",
      conviction: 8,
      parsed: true,
      evidenceCount: 1,
      evidence: [
        expect.objectContaining({
          tool: "get_stock_quote",
          args: '{"symbol":"NVDA"}',
          freshness: {
            fetchedAt: "2026-07-05T19:00:00.000Z",
            providerDataAt: "2026-07-02T20:00:00.000Z",
            cacheStatus: "live",
            marketSession: "closed_weekend",
            isStaleForSession: false,
          },
          resultDigest: {
            preview: expect.stringContaining('"symbol":"NVDA"'),
            totalLength: expect.any(Number),
          },
        }),
      ],
    });
  });

  it("stores parsed analyst output and appends an analyst-step entry", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    const pi = {
      sendUserMessage: vi.fn(() => {
        entries.push(userTextEntry("valuation prompt"));
        setTimeout(() => {
          entries.push(
            assistantTextEntry(
              "Valuation work.\nSIGNAL: BUY\nCONVICTION: 8\nTHESIS: Revenue growth supports upside.",
            ),
          );
        }, 10);
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(
      pi as never,
      analystWorkflowDefinition(),
      fakeQueueContext(() => true, entries),
    );

    await vi.advanceTimersByTimeAsync(500);
    const output = coord.getRunner().getActiveRun()?.stepOutputs.get(0);

    expect(output?.analystOutput).toMatchObject({
      role: "valuation",
      signal: "BUY",
      conviction: 8,
      thesis: "Revenue growth supports upside.",
    });
    expect(pi.appendEntry).toHaveBeenCalledWith("opencandle-analyst-step", {
      stage: "analyst_valuation",
      role: "valuation",
      signal: "BUY",
      conviction: 8,
      parsed: true,
      evidenceCount: 0,
      evidence: [],
    });
  });

  it("re-prompts once on analyst parse failure, records parsed false, and completes the step", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    const pi = {
      sendUserMessage: vi.fn((prompt: string) => {
        entries.push(userTextEntry(prompt));
        setTimeout(() => {
          entries.push(assistantTextEntry("I have a view, but no required footer."));
        }, 10);
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(
      pi as never,
      analystWorkflowDefinition(),
      fakeQueueContext(() => true, entries),
    );

    await vi.advanceTimersByTimeAsync(800);
    const run = coord.getRunner().getActiveRun();

    expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);
    expect(pi.sendUserMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("exact required final output format"),
    );
    expect(run?.status).toBe("completed");
    expect(run?.steps[0].status).toBe("completed");
    expect(run?.stepOutputs.get(0)?.rawText).toContain("no required footer");
    expect(run?.stepOutputs.get(0)?.analystOutput).toBeUndefined();
    expect(pi.appendEntry).toHaveBeenCalledWith("opencandle-analyst-step", {
      stage: "analyst_valuation",
      role: "valuation",
      parsed: false,
      evidenceCount: 0,
      evidence: [],
    });
  });

  it("treats an empty analyst response as a parse failure with re-prompt and entry", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    const pi = {
      sendUserMessage: vi.fn((prompt: string) => {
        entries.push(userTextEntry(prompt));
        setTimeout(() => {
          entries.push(assistantTextEntry(""));
        }, 10);
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(
      pi as never,
      analystWorkflowDefinition(),
      fakeQueueContext(() => true, entries),
    );

    await vi.advanceTimersByTimeAsync(800);
    const run = coord.getRunner().getActiveRun();

    // Empty text is a parse failure, not an invisible non-event: one
    // re-prompt, then a parsed:false entry so the projector and
    // skipped_unparsed accounting can see the step.
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);
    expect(run?.steps[0].status).toBe("completed");
    expect(run?.stepOutputs.get(0)?.parsed).toBe(false);
    expect(pi.appendEntry).toHaveBeenCalledWith(
      "opencandle-analyst-step",
      expect.objectContaining({ stage: "analyst_valuation", parsed: false }),
    );
  });

  it("rejects out-of-range conviction instead of recording a fabricated default", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    const pi = {
      sendUserMessage: vi.fn((prompt: string) => {
        entries.push(userTextEntry(prompt));
        setTimeout(() => {
          entries.push(
            assistantTextEntry("Sure of it.\nSIGNAL: BUY\nCONVICTION: 15\nTHESIS: Overconfident."),
          );
        }, 10);
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(
      pi as never,
      analystWorkflowDefinition(),
      fakeQueueContext(() => true, entries),
    );

    await vi.advanceTimersByTimeAsync(800);
    const run = coord.getRunner().getActiveRun();

    // CONVICTION: 15 is outside the 1-10 contract; parseAnalystOutput would
    // silently default it to 5, fabricating a conviction that feeds the
    // weighted tally. The step must take the parse-failure path instead.
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);
    expect(run?.stepOutputs.get(0)?.parsed).toBe(false);
    expect(pi.appendEntry).toHaveBeenCalledWith(
      "opencandle-analyst-step",
      expect.objectContaining({ stage: "analyst_valuation", parsed: false }),
    );
  });

  it("runs the rebuttal when fewer than two analysts parsed (no trustworthy consensus)", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    const pi = {
      sendUserMessage: vi.fn((prompt: string) => {
        entries.push(userTextEntry(prompt));
        const response = prompt.includes("revise")
          ? "Still no structured footer."
          : prompt.includes("bull prompt")
            ? "BULL THESIS: Upside remains plausible.\nKEY RISK TO THIS THESIS: Support breaks."
            : prompt.includes("bear prompt")
              ? "BEAR THESIS: Downside evidence is stronger.\nWHAT WOULD CHANGE MY MIND: Breakout above resistance."
              : prompt.includes("rebuttal prompt")
                ? "CONCESSIONS: - Momentum is weak.\nREMAINING CONVICTION: 6"
                : prompt.includes("synthesis prompt")
                  ? "VERDICT: HOLD\nCONFIDENCE: 5\nDEBATE WINNER: BEAR\nREVERSAL CONDITION: Close above resistance."
                  : "No structured footer.";
        setTimeout(() => entries.push(assistantTextEntry(response)), 10);
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(
      pi as never,
      deterministicWorkflowDefinition(),
      fakeQueueContext(() => true, entries),
    );

    await vi.advanceTimersByTimeAsync(2000);
    const run = coord.getRunner().getActiveRun();

    // Degradation rule: with zero/one parsed analyst there is no consensus
    // signal to gate on; the rebuttal must run exactly as the status quo,
    // not be skipped because isAnalystSplit([]) is false.
    expect(pi.sendUserMessage).toHaveBeenCalledWith("rebuttal prompt");
    expect(run?.steps.find((step) => step.stepType === "debate_rebuttal")?.status).toBe(
      "completed",
    );
  });

  it("stores parsed debate output and appends an analyst-step entry", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    const pi = {
      sendUserMessage: vi.fn(() => {
        entries.push(userTextEntry("bull prompt"));
        setTimeout(() => {
          entries.push(
            assistantTextEntry(
              "BULL THESIS: Cash flow momentum can support upside.\nKEY RISK TO THIS THESIS: Guidance misses would invalidate it.",
            ),
          );
        }, 10);
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(
      pi as never,
      debateWorkflowDefinition(),
      fakeQueueContext(() => true, entries),
    );

    await vi.advanceTimersByTimeAsync(500);
    const output = coord.getRunner().getActiveRun()?.stepOutputs.get(0);

    expect(output?.debateOutput).toMatchObject({
      side: "bull",
      thesis: "Cash flow momentum can support upside.",
      keyRisk: "Guidance misses would invalidate it.",
    });
    expect(pi.appendEntry).toHaveBeenCalledWith("opencandle-analyst-step", {
      stage: "debate_bull",
      side: "bull",
      parsed: true,
      evidenceCount: 0,
      evidence: [],
    });
  });

  it("injects a computed vote tally into synthesis when at least two analysts parse", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    const responses = [
      "Valuation work.\nSIGNAL: BUY\nCONVICTION: 8\nTHESIS: Growth supports upside.",
      "Momentum work.\nSIGNAL: SELL\nCONVICTION: 6\nTHESIS: Price action is weakening.",
      "BULL THESIS: Upside remains plausible.\nKEY RISK TO THIS THESIS: Support breaks.",
      "BEAR THESIS: Downside evidence is stronger.\nWHAT WOULD CHANGE MY MIND: Breakout above resistance.",
      "CONCESSIONS: - Momentum is weak.\nREMAINING CONVICTION: 6",
      "VERDICT: HOLD\nCONFIDENCE: 5\nDEBATE WINNER: BEAR\nREVERSAL CONDITION: Close above resistance.",
    ];
    const pi = {
      sendUserMessage: vi.fn((prompt: string) => {
        entries.push(userTextEntry(prompt));
        const response = responses.shift() ?? "";
        setTimeout(() => entries.push(assistantTextEntry(response)), 10);
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(
      pi as never,
      deterministicWorkflowDefinition(),
      fakeQueueContext(() => true, entries),
    );

    await vi.advanceTimersByTimeAsync(1200);

    const sentPrompts = (pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls.map(
      ([prompt]) => prompt as string,
    );
    const synthesisPrompt = sentPrompts.find((prompt) => prompt.includes("synthesis prompt"));
    expect(synthesisPrompt).toContain("## Deterministic Analyst Vote Tally");
    expect(synthesisPrompt).toContain("- BUY: 1");
    expect(synthesisPrompt).toContain("- HOLD: 0");
    expect(synthesisPrompt).toContain("- SELL: 1");
    expect(synthesisPrompt).toContain("- Weighted average conviction: 7");
    expect(synthesisPrompt).toContain("- Computed verdict: BUY");
    expect(synthesisPrompt).toContain("synthesis prompt");
    expect(pi.appendEntry).toHaveBeenCalledWith("opencandle-workflow-event", {
      eventType: "tally_injected",
      tallyBlock: expect.stringContaining("## Deterministic Analyst Vote Tally"),
      parsedAnalystCount: 2,
    });
  });

  it("skips tally injection and records tally_skipped when fewer than two analysts parse", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    const pi = {
      sendUserMessage: vi.fn((prompt: string) => {
        entries.push(userTextEntry(prompt));
        const response = prompt.includes("revise")
          ? "Still no structured footer."
          : prompt === "valuation prompt"
            ? "Valuation work.\nSIGNAL: BUY\nCONVICTION: 8\nTHESIS: Growth supports upside."
            : prompt === "momentum prompt"
              ? "No structured footer."
              : prompt === "bull prompt"
                ? "BULL THESIS: Upside remains plausible.\nKEY RISK TO THIS THESIS: Support breaks."
                : prompt === "bear prompt"
                  ? "BEAR THESIS: Downside evidence is stronger.\nWHAT WOULD CHANGE MY MIND: Breakout above resistance."
                  : "VERDICT: HOLD\nCONFIDENCE: 5\nDEBATE WINNER: BEAR\nREVERSAL CONDITION: Close above resistance.";
        setTimeout(() => entries.push(assistantTextEntry(response)), 10);
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(
      pi as never,
      deterministicWorkflowDefinition(),
      fakeQueueContext(() => true, entries),
    );

    await vi.advanceTimersByTimeAsync(1400);

    const sentPrompts = (pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls.map(
      ([prompt]) => prompt as string,
    );
    const synthesisPrompt = sentPrompts.find((prompt) => prompt.includes("synthesis prompt"));
    expect(synthesisPrompt).toBe("synthesis prompt");
    expect(pi.appendEntry).toHaveBeenCalledWith("opencandle-workflow-event", {
      eventType: "tally_skipped",
      reason: "fewer_than_2_parsed_analysts",
      parsedAnalystCount: 1,
    });
  });

  it("skips rebuttal programmatically when parsed analysts do not include a BUY and SELL split", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    const responses = [
      "Valuation work.\nSIGNAL: BUY\nCONVICTION: 8\nTHESIS: Growth supports upside.",
      "Momentum work.\nSIGNAL: HOLD\nCONVICTION: 6\nTHESIS: Price action is balanced.",
      "BULL THESIS: Upside remains plausible.\nKEY RISK TO THIS THESIS: Support breaks.",
      "BEAR THESIS: Risks remain.\nWHAT WOULD CHANGE MY MIND: Breakout above resistance.",
      "VERDICT: BUY\nCONFIDENCE: 6\nDEBATE WINNER: BULL\nREVERSAL CONDITION: Support breaks.",
    ];
    const pi = {
      sendUserMessage: vi.fn((prompt: string) => {
        entries.push(userTextEntry(prompt));
        const response = responses.shift() ?? "";
        setTimeout(() => entries.push(assistantTextEntry(response)), 10);
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(
      pi as never,
      deterministicWorkflowDefinition(),
      fakeQueueContext(() => true, entries),
    );

    await vi.advanceTimersByTimeAsync(1200);

    expect(pi.sendUserMessage).not.toHaveBeenCalledWith("rebuttal prompt");
    const run = coord.getRunner().getActiveRun();
    expect(run?.steps.find((step) => step.stepType === "debate_rebuttal")?.status).toBe("skipped");
    expect(pi.appendEntry).toHaveBeenCalledWith("opencandle-workflow-event", {
      eventType: "step_skipped",
      stepType: "debate_rebuttal",
      reason: "analyst_consensus",
    });
  });

  it("emits observe-only validation after synthesis with mismatches and skipped unparsed analysts", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    type Handler = (event: never) => void;
    const handlers = new Map<string, Handler[]>();
    const emit = (name: string, event: unknown) => {
      for (const handler of handlers.get(name) ?? []) {
        handler(event as never);
      }
    };
    const pi = {
      on: vi.fn((name: string, handler: Handler) => {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      }),
      sendUserMessage: vi.fn((prompt: string) => {
        entries.push(userTextEntry(prompt));
        const response = prompt.includes("revise")
          ? "Still no structured footer."
          : prompt === "valuation prompt"
            ? "Valuation work. The price is 100.\nSIGNAL: BUY\nCONVICTION: 8\nTHESIS: Growth supports upside."
            : prompt === "momentum prompt"
              ? "No structured footer."
              : prompt === "bull prompt"
                ? "BULL THESIS: Upside remains plausible.\nKEY RISK TO THIS THESIS: Support breaks."
                : prompt === "bear prompt"
                  ? "BEAR THESIS: Downside evidence is stronger.\nWHAT WOULD CHANGE MY MIND: Breakout above resistance."
                  : "VERDICT: BUY\nCONFIDENCE: 6\nDEBATE WINNER: BULL\nREVERSAL CONDITION: Support breaks.";
        setTimeout(() => {
          if (prompt === "valuation prompt") {
            emit("tool_execution_start", {
              toolCallId: "tc-price",
              toolName: "seed_validation",
              args: {},
            });
            emit("tool_execution_end", {
              toolCallId: "tc-price",
              toolName: "seed_validation",
              result: { price: 101 },
              isError: false,
            });
          }
          entries.push(assistantTextEntry(response));
        }, 10);
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(
      pi as never,
      deterministicWorkflowDefinition(),
      fakeQueueContext(() => true, entries),
    );

    await vi.advanceTimersByTimeAsync(1400);

    expect(pi.appendEntry).toHaveBeenCalledWith("opencandle-validation", {
      passed: false,
      mismatches: [
        expect.objectContaining({
          evidenceLabel: "seed_validation.price",
          message: expect.stringContaining("mismatch"),
        }),
      ],
      skipped_unparsed: ["analyst_momentum"],
    });
    expect(pi.appendEntry).toHaveBeenCalledWith("opencandle-workflow-event", {
      eventType: "validation_failed",
      mismatches: expect.any(Array),
      skipped_unparsed: ["analyst_momentum"],
    });
  });

  it("includes the current synthesis output when emitting validation", async () => {
    vi.useFakeTimers();
    const coord = new SessionCoordinator();
    const entries: SessionEntry[] = [];
    type Handler = (event: never) => void;
    const handlers = new Map<string, Handler[]>();
    const emit = (name: string, event: unknown) => {
      for (const handler of handlers.get(name) ?? []) {
        handler(event as never);
      }
    };
    const responses = [
      "Valuation work. The price is 101.\nSIGNAL: BUY\nCONVICTION: 8\nTHESIS: Growth supports upside.",
      "Momentum work.\nSIGNAL: HOLD\nCONVICTION: 6\nTHESIS: Price action is balanced.",
      "BULL THESIS: Upside remains plausible.\nKEY RISK TO THIS THESIS: Support breaks.",
      "BEAR THESIS: Downside evidence is stronger.\nWHAT WOULD CHANGE MY MIND: Breakout above resistance.",
      "VERDICT: BUY\nCONFIDENCE: 6\nDEBATE WINNER: BULL\nREVERSAL CONDITION: The price is 100.",
    ];
    const pi = {
      on: vi.fn((name: string, handler: Handler) => {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      }),
      sendUserMessage: vi.fn((prompt: string) => {
        entries.push(userTextEntry(prompt));
        const response = responses.shift() ?? "";
        setTimeout(() => {
          if (prompt === "valuation prompt") {
            emit("tool_execution_start", {
              toolCallId: "tc-price",
              toolName: "seed_validation",
              args: {},
            });
            emit("tool_execution_end", {
              toolCallId: "tc-price",
              toolName: "seed_validation",
              result: { price: 101 },
              isError: false,
            });
          }
          entries.push(assistantTextEntry(response));
        }, 10);
      }),
      appendEntry: vi.fn(),
    };

    coord.executeWorkflow(
      pi as never,
      deterministicWorkflowDefinition(),
      fakeQueueContext(() => true, entries),
    );

    await vi.advanceTimersByTimeAsync(1400);

    expect(pi.appendEntry).toHaveBeenCalledWith("opencandle-validation", {
      passed: false,
      mismatches: [
        expect.objectContaining({
          evidenceLabel: "seed_validation.price",
          message: expect.stringContaining("mismatch"),
        }),
      ],
      skipped_unparsed: [],
    });
    expect(pi.appendEntry).toHaveBeenCalledWith("opencandle-workflow-event", {
      eventType: "validation_failed",
      mismatches: expect.any(Array),
      skipped_unparsed: [],
    });
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

  it("includes portfolio, watchlist, alerts, and reports in prompt context", () => {
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
    db.close();

    const coord = new SessionCoordinator({
      stateDatabaseFactory: initDefaultDatabase,
    });
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
    expect(prompt).toContain("price_crosses_above");
    expect(prompt).toContain("Morning watchlist");
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

    const coord = new SessionCoordinator({
      stateDatabaseFactory: initDefaultDatabase,
    });
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

    const coord = new SessionCoordinator({
      stateDatabaseFactory: initDefaultDatabase,
    });
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
