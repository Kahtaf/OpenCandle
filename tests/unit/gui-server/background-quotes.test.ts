import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_QUOTE_POLL_INTERVAL_MS,
  BackgroundQuoteRefreshes,
  createBackgroundQuotePoller,
} from "../../../gui/server/background-quotes.js";
import type { invokeToolFromUi } from "../../../gui/server/invoke-tool.js";

describe("BackgroundQuoteRefreshes", () => {
  it("adds synthetic quote refreshes without mutating persisted session entries", () => {
    const persisted: SessionEntry[] = [];
    const refreshes = new BackgroundQuoteRefreshes();

    refreshes.upsert({
      symbol: "NVDA",
      toolName: "get_stock_quote",
      args: { symbol: "NVDA" },
      value: { symbol: "NVDA", price: 216 },
      content: [{ type: "text", text: "NVDA quote" }],
      isError: false,
    });

    const entries = refreshes.withEntries(persisted);
    expect(persisted).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "custom",
      customType: "opencandle-quote-refresh",
      data: {
        symbol: "NVDA",
        value: { symbol: "NVDA", price: 216 },
      },
    });
  });

  it("keeps only the latest refresh per symbol", () => {
    const refreshes = new BackgroundQuoteRefreshes();

    refreshes.upsert({
      symbol: "NVDA",
      toolName: "get_stock_quote",
      args: { symbol: "NVDA" },
      value: { symbol: "NVDA", price: 216 },
      content: [{ type: "text", text: "old" }],
      isError: false,
    });
    refreshes.upsert({
      symbol: "NVDA",
      toolName: "get_stock_quote",
      args: { symbol: "NVDA" },
      value: { symbol: "NVDA", price: 217 },
      content: [{ type: "text", text: "new" }],
      isError: false,
    });

    const entries = refreshes.withEntries([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      data: {
        symbol: "NVDA",
        value: { symbol: "NVDA", price: 217 },
        content: [{ type: "text", text: "new" }],
      },
    });
  });

  it("starts polling when clients connect and stops when all clients disconnect", () => {
    let clients = 0;
    const intervalHandle = {} as ReturnType<typeof setInterval>;
    const setIntervalFn = vi.fn(() => intervalHandle);
    const clearIntervalFn = vi.fn();
    const poller = createBackgroundQuotePoller({
      getClientCount: () => clients,
      getSessionManager: () => sessionManagerWithEntries([]),
      refreshes: new BackgroundQuoteRefreshes(),
      broadcastState: vi.fn(),
      setIntervalFn,
      clearIntervalFn,
    });

    poller.updatePoller();
    expect(setIntervalFn).not.toHaveBeenCalled();

    clients = 1;
    poller.updatePoller();
    poller.updatePoller();

    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(setIntervalFn).toHaveBeenCalledWith(
      expect.any(Function),
      BACKGROUND_QUOTE_POLL_INTERVAL_MS,
    );

    clients = 0;
    poller.updatePoller();

    expect(clearIntervalFn).toHaveBeenCalledWith(intervalHandle);
  });

  it("skips overlapping quote refreshes and clears the in-flight guard", async () => {
    let releaseRefresh: (() => void) | null = null;
    let resolveStarted: (() => void) | null = null;
    let invocationCount = 0;
    const refreshStarted = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const invokeTool = vi.fn(async () => {
      invocationCount += 1;
      if (invocationCount === 1) {
        resolveStarted?.();
        await new Promise<void>((resolve) => {
          releaseRefresh = resolve;
        });
      }
      return {
        toolCallId: "background-quote",
        result: {
          details: { symbol: "NVDA", price: 217 },
          content: [{ type: "text", text: "NVDA quote" }],
        },
        isError: false,
      };
    }) as unknown as typeof invokeToolFromUi;
    const broadcastState = vi.fn();
    const poller = createBackgroundQuotePoller({
      getClientCount: () => 1,
      getSessionManager: () => sessionManagerWithEntries([quoteRefreshEntry("NVDA")]),
      refreshes: new BackgroundQuoteRefreshes(),
      broadcastState,
      getTools: () => getFakeTools(),
      invokeTool,
    });

    const first = poller.pollVisibleQuotes();
    await refreshStarted;
    await poller.pollVisibleQuotes();
    expect(invokeTool).toHaveBeenCalledTimes(1);
    releaseRefresh?.();
    await first;
    await poller.pollVisibleQuotes();

    expect(invokeTool).toHaveBeenCalledTimes(2);
    expect(broadcastState).toHaveBeenCalledTimes(2);
  });
});

function sessionManagerWithEntries(entries: SessionEntry[]): SessionManager {
  return {
    getEntries: () => entries,
    getSessionId: () => "session-1",
  } as unknown as SessionManager;
}

function quoteRefreshEntry(symbol: string): SessionEntry {
  return {
    type: "custom",
    id: `quote-${symbol}`,
    parentId: null,
    timestamp: "2026-06-13T00:00:00.000Z",
    customType: "opencandle-quote-refresh",
    data: {
      symbol,
      value: { symbol, price: 216 },
      content: [{ type: "text", text: `${symbol} quote` }],
    },
  } as SessionEntry;
}

function getFakeTools() {
  return [{ name: "get_stock_quote" }];
}
