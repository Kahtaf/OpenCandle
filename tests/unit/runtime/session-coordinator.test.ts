import { describe, it, expect } from "vitest";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
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
      content: [
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

describe("SessionCoordinator.buildPriorTurns", () => {
  it("returns empty array for an empty branch", () => {
    const coord = new SessionCoordinator();
    const turns = coord.buildPriorTurns(fakeSessionManager([]));
    expect(turns).toEqual([]);
  });

  it("returns a single user message when the branch has only one", () => {
    const coord = new SessionCoordinator();
    const turns = coord.buildPriorTurns(
      fakeSessionManager([userTextEntry("tell me about NVDA")]),
    );
    expect(turns).toEqual([{ role: "user", text: "tell me about NVDA" }]);
  });

  it("accepts user messages with plain-string content", () => {
    const coord = new SessionCoordinator();
    const turns = coord.buildPriorTurns(
      fakeSessionManager([userStringEntry("hello world")]),
    );
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
      fakeSessionManager([
        userTextEntry("run the analysis"),
        assistantEmptyEntry(),
      ]),
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
      fakeSessionManager([
        userTextEntry("one"),
        userTextEntry("two"),
        userTextEntry("three"),
      ]),
      2,
    );
    expect(turns.map((t) => t.text)).toEqual(["two", "three"]);
  });
});

describe("SessionCoordinator.buildRouterContextBase", () => {
  it("includes priorTurns alongside profile + recent runs", () => {
    const coord = new SessionCoordinator();
    const mgr = fakeSessionManager([
      userTextEntry("hello"),
      assistantTextEntry("hi"),
    ]);
    const ctx = coord.buildRouterContextBase(mgr);
    expect(ctx.priorTurns).toEqual([
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi" },
    ]);
    expect(ctx.profileSnapshot).toEqual({});
    expect(ctx.recentWorkflowRuns).toEqual([]);
  });
});
