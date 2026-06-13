import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

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
