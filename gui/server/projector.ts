import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";

export interface DashboardState {
  watchlist: Array<{
    symbol: string;
    quote: Record<string, unknown> | null;
    pinned: boolean;
    lastSeen: string;
  }>;
  activeAnalyses: Array<{
    workflowId: string;
    workflow: string;
    symbol?: string;
    analystsTotal: number;
    analystsDone: number;
    startedAt: string;
  }>;
  recentResearch: Array<{
    sessionId: string;
    workflow: string;
    symbol?: string;
    completedAt: string;
  }>;
  dataQuality: {
    softGaps: Array<{ provider: string; lastSeen: string }>;
    hardSkips: Array<{ provider: string; lastSeen: string }>;
  };
}

const DIRECT_TOOL_GAP_PROVIDERS: Record<string, string> = {
  get_company_overview: "alpha_vantage",
  get_financials: "alpha_vantage",
  get_earnings: "alpha_vantage",
  compute_dcf: "alpha_vantage",
  compare_companies: "alpha_vantage",
  get_economic_data: "fred",
  get_twitter_sentiment: "twitter",
};

export function createEmptyDashboardState(): DashboardState {
  return {
    watchlist: [],
    activeAnalyses: [],
    recentResearch: [],
    dataQuality: { softGaps: [], hardSkips: [] },
  };
}

export function projectDashboard(entries: SessionEntry[], sessionId = "local"): DashboardState {
  const state = createEmptyDashboardState();

  for (const entry of entries) {
    if (entry.type === "message") {
      projectMessage(state, entry.message as Message, entry.timestamp, sessionId);
      continue;
    }

    if (entry.type === "custom" && entry.customType === "opencandle-workflow") {
      const data = asRecord(entry.data);
      const workflow = stringValue(data.workflow) ?? stringValue(data.workflowType) ?? "workflow";
      const slots = asRecord(data.resolvedSlots);
      const symbol = stringValue(slots.symbol) ?? firstString(slots.symbols);
      state.activeAnalyses.push({
        workflowId: stringValue(data.runId) ?? entry.id,
        workflow,
        symbol,
        analystsTotal: numberValue(data.analystsTotal) ?? 0,
        analystsDone: 0,
        startedAt: entry.timestamp,
      });
      continue;
    }

    if (entry.type === "custom" && entry.customType === "opencandle-turn-gap") {
      // The accumulator writes a single combined annotation string with one
      // [OPENCANDLE_SKIPPED ... provider=X ...] tag per fallback provider.
      // Older shapes may carry { softGaps: [...] } or { provider } directly —
      // accept either to stay forward/backward compatible.
      const data = asRecord(entry.data);
      const annotation = stringValue(data.annotation);
      if (annotation) {
        for (const provider of parseSkippedProviders(annotation)) {
          state.dataQuality.softGaps.push({ provider, lastSeen: entry.timestamp });
        }
      }
      for (const gap of asArray(data.softGaps)) {
        const provider = stringValue(asRecord(gap).provider);
        if (provider) state.dataQuality.softGaps.push({ provider, lastSeen: entry.timestamp });
      }
      const provider = stringValue(data.provider);
      if (provider) state.dataQuality.softGaps.push({ provider, lastSeen: entry.timestamp });
    }

    if (entry.type === "custom" && entry.customType === "opencandle-quote-refresh") {
      const data = asRecord(entry.data);
      projectQuote(
        state,
        stringValue(data.symbol),
        asRecord(data.value),
        asArray(data.content) as ToolResultMessage["content"],
        entry.timestamp,
      );
    }
  }

  return state;
}

function projectMessage(
  state: DashboardState,
  message: Message,
  timestamp: string,
  sessionId: string,
): void {
  if (message.role === "toolResult") {
    projectToolResult(state, message, timestamp);
    return;
  }

  if (message.role === "assistant" && message.stopReason === "stop") {
    const active = state.activeAnalyses.shift();
    if (active) {
      state.recentResearch.unshift({
        sessionId,
        workflow: active.workflow,
        symbol: active.symbol,
        completedAt: timestamp,
      });
    }
  }
}

function projectToolResult(
  state: DashboardState,
  message: ToolResultMessage,
  timestamp: string,
): void {
  if (message.toolName === "get_stock_quote") {
    const rawDetails = asRecord(message.details);
    const nestedValue = asRecord(rawDetails.value);
    const details = Object.keys(nestedValue).length > 0 ? nestedValue : rawDetails;
    projectQuote(state, stringValue(details.symbol), details, message.content, timestamp);
  }

  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  for (const provider of parseSoftGapProviders(text)) {
    state.dataQuality.softGaps.push({ provider, lastSeen: timestamp });
  }
  for (const provider of parseCredentialRequiredProviders(text)) {
    state.dataQuality.hardSkips.push({ provider, lastSeen: timestamp });
  }
  const provider = inferDirectToolGapProvider(message.toolName, text);
  if (provider) state.dataQuality.softGaps.push({ provider, lastSeen: timestamp });
}

function projectQuote(
  state: DashboardState,
  symbolHint: string | undefined,
  details: Record<string, unknown>,
  content: ToolResultMessage["content"],
  timestamp: string,
): void {
  const symbol = symbolHint ?? inferSymbolFromContent(content);
  if (!symbol) return;

  const existing = state.watchlist.find((row) => row.symbol === symbol);
  const row = {
    symbol,
    quote: Object.keys(details).length > 0 ? details : null,
    pinned: existing?.pinned ?? false,
    lastSeen: timestamp,
  };
  if (existing) Object.assign(existing, row);
  else state.watchlist.push(row);
}

function parseCredentialRequiredProviders(text: string): string[] {
  const providers: string[] = [];
  const re = /\[OPENCANDLE_CREDENTIAL_REQUIRED[^\]]*provider=([a-z0-9_-]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    providers.push(match[1]);
  }
  return providers;
}

function parseSkippedProviders(text: string): string[] {
  return parseSoftGapProviders(text);
}

function parseSoftGapProviders(text: string): string[] {
  const providers: string[] = [];
  const re = /\[OPENCANDLE_(?:SKIPPED|SOFT_DEGRADED)[^\]]*provider=([a-z0-9_-]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    providers.push(match[1]);
  }
  return providers;
}

function inferDirectToolGapProvider(toolName: string | undefined, text: string): string | undefined {
  if (!toolName || !/(?:⚠|unavailable|No .*data found|LOGIN_NEEDED)/i.test(text)) return undefined;
  return DIRECT_TOOL_GAP_PROVIDERS[toolName];
}

function inferSymbolFromContent(content: ToolResultMessage["content"]): string | undefined {
  const text = content.find((part) => part.type === "text")?.text;
  const match = text?.match(/^([A-Z]{1,8})\b/);
  return match?.[1];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function firstString(value: unknown): string | undefined {
  return Array.isArray(value) ? value.find((item) => typeof item === "string") : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
