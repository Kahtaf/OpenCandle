import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { getAllTools } from "../../src/tools/index.js";
import { invokeToolFromUi } from "./invoke-tool.js";
import { projectDashboard } from "./projector.js";

export const BACKGROUND_QUOTE_POLL_INTERVAL_MS = 30_000;

export interface BackgroundQuoteRefresh {
  symbol: string;
  toolName: string;
  args: Record<string, unknown>;
  value: unknown;
  content: ToolResultMessage["content"];
  isError: boolean;
}

export class BackgroundQuoteRefreshes {
  private readonly entriesBySymbol = new Map<string, SessionEntry>();

  upsert(refresh: BackgroundQuoteRefresh): void {
    const timestamp = new Date().toISOString();
    this.entriesBySymbol.set(refresh.symbol, {
      type: "custom",
      id: `background-quote-${refresh.symbol}`,
      parentId: null,
      timestamp,
      customType: "opencandle-quote-refresh",
      data: refresh,
    } as SessionEntry);
  }

  withEntries(entries: SessionEntry[]): SessionEntry[] {
    return [...entries, ...this.entriesBySymbol.values()];
  }
}

type IntervalHandle = ReturnType<typeof setInterval>;
type SetIntervalFn = (callback: () => void, ms: number) => IntervalHandle;
type ClearIntervalFn = (handle: IntervalHandle) => void;

export interface BackgroundQuotePoller {
  updatePoller(): void;
  pollVisibleQuotes(): Promise<void>;
  stop(): void;
}

export interface BackgroundQuotePollerOptions {
  getClientCount: () => number;
  getSessionManager: () => SessionManager;
  refreshes: BackgroundQuoteRefreshes;
  broadcastState: () => void;
  getTools?: typeof getAllTools;
  invokeTool?: typeof invokeToolFromUi;
  setIntervalFn?: SetIntervalFn;
  clearIntervalFn?: ClearIntervalFn;
  warn?: (message: string) => void;
}

export function createBackgroundQuotePoller({
  getClientCount,
  getSessionManager,
  refreshes,
  broadcastState,
  getTools = getAllTools,
  invokeTool = invokeToolFromUi,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  warn = (message) => console.warn(message),
}: BackgroundQuotePollerOptions): BackgroundQuotePoller {
  let poller: IntervalHandle | null = null;
  let quotePollInFlight = false;

  async function pollVisibleQuotes(): Promise<void> {
    if (quotePollInFlight) return;
    quotePollInFlight = true;
    try {
      const sessionManager = getSessionManager();
      const state = projectDashboard(sessionManager.getEntries(), sessionManager.getSessionId());
      const tool = getTools().find((candidate) => candidate.name === "get_stock_quote");
      if (!tool) return;
      for (const row of state.watchlist.filter((item) => item.pinned || item.quote)) {
        const result = await invokeTool(
          sessionManager,
          tool,
          { symbol: row.symbol },
          "background",
          { recordTranscript: false },
        );
        refreshes.upsert({
          symbol: row.symbol,
          toolName: tool.name,
          args: { symbol: row.symbol },
          value: result.result.details,
          content: result.result.content,
          isError: result.isError,
        });
      }
      broadcastState();
    } catch (error) {
      warn(
        `Background quote refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      quotePollInFlight = false;
    }
  }

  function updatePoller(): void {
    if (getClientCount() > 0 && !poller) {
      poller = setIntervalFn(() => void pollVisibleQuotes(), BACKGROUND_QUOTE_POLL_INTERVAL_MS);
    }
    if (getClientCount() === 0 && poller) {
      clearIntervalFn(poller);
      poller = null;
    }
  }

  function stop(): void {
    if (poller) {
      clearIntervalFn(poller);
      poller = null;
    }
  }

  return { updatePoller, pollVisibleQuotes, stop };
}
