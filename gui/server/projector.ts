import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export interface DashboardState {
  knownSymbols: string[];
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
  lastTurn?: {
    routeKind: string;
    workflow?: string;
    symbols: string[];
    slotSources: Record<string, number>;
    priorTurnCount: number;
    savedStateIncluded?: boolean;
    attachmentCount?: number;
    validation?: { passed: boolean; mismatchCount: number };
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
  get_reddit_sentiment: "reddit",
};

export function createEmptyDashboardState(): DashboardState {
  return {
    knownSymbols: [],
    watchlist: [],
    activeAnalyses: [],
    recentResearch: [],
    dataQuality: { softGaps: [], hardSkips: [] },
  };
}

export function projectDashboard(
  entries: SessionEntry[],
  sessionId = "local",
  savedSymbols: string[] = [],
): DashboardState {
  const state = createEmptyDashboardState();
  let pendingAttachmentCount: number | undefined;
  let pendingAttachmentUserSeen = false;

  for (const entry of entries) {
    if (entry.type === "message") {
      projectMessage(state, entry.message as Message, entry.timestamp, sessionId);
      const message = entry.message as Message;
      if (pendingAttachmentCount !== undefined) {
        if (message.role === "user") pendingAttachmentUserSeen = true;
        else if (pendingAttachmentUserSeen) {
          pendingAttachmentCount = undefined;
          pendingAttachmentUserSeen = false;
        }
      }
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

    if (entry.type === "custom" && entry.customType === "opencandle-user-input") {
      const attachments = asArray(asRecord(entry.data).attachments);
      pendingAttachmentCount = attachments.length > 0 ? attachments.length : undefined;
      pendingAttachmentUserSeen = false;
      if (state.lastTurn) {
        if (pendingAttachmentCount !== undefined)
          state.lastTurn.attachmentCount = pendingAttachmentCount;
        else delete state.lastTurn.attachmentCount;
      }
      continue;
    }

    if (entry.type === "custom" && entry.customType === "opencandle-route-context") {
      state.lastTurn = projectRouteContext(entry.data, pendingAttachmentCount);
      addKnownSymbols(state, asArray(asRecord(asRecord(entry.data).entities).symbols));
      pendingAttachmentCount = undefined;
      pendingAttachmentUserSeen = false;
      continue;
    }

    if (pendingAttachmentUserSeen) {
      pendingAttachmentCount = undefined;
      pendingAttachmentUserSeen = false;
    }

    if (entry.type === "custom" && entry.customType === "opencandle-validation") {
      if (state.lastTurn) {
        const data = asRecord(entry.data);
        state.lastTurn.validation = {
          passed: Boolean(data.passed),
          mismatchCount: asArray(data.mismatches).length,
        };
      }
      continue;
    }

    if (entry.type === "custom" && entry.customType === "opencandle-analyst-step") {
      // debate_* stages share this entry type but are not analysts.
      const stage = stringValue(asRecord(entry.data).stage) ?? "";
      const active = state.activeAnalyses[state.activeAnalyses.length - 1];
      if (active && stage.startsWith("analyst_")) {
        const nextDone = active.analystsDone + 1;
        active.analystsDone =
          active.analystsTotal > 0 ? Math.min(nextDone, active.analystsTotal) : nextDone;
      }
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
          upsertProviderGap(state.dataQuality.softGaps, provider, entry.timestamp);
        }
      }
      for (const gap of asArray(data.softGaps)) {
        const provider = stringValue(asRecord(gap).provider);
        if (provider) upsertProviderGap(state.dataQuality.softGaps, provider, entry.timestamp);
      }
      const provider = stringValue(data.provider);
      if (provider) upsertProviderGap(state.dataQuality.softGaps, provider, entry.timestamp);
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

  addKnownSymbols(state, savedSymbols);
  return state;
}

function projectRouteContext(
  data: unknown,
  attachmentCount: number | undefined,
): DashboardState["lastTurn"] {
  const record = asRecord(data);
  const entities = asRecord(record.entities);
  const routeKind = stringValue(record.routeKind) ?? "unknown";
  const workflow = stringValue(record.workflow);
  const slots = asRecord(record.slots);
  const slotSources: Record<string, number> = {};
  for (const slot of Object.values(slots)) {
    const source = stringValue(asRecord(slot).source);
    if (!source) continue;
    slotSources[source] = (slotSources[source] ?? 0) + 1;
  }
  const symbols = stringArray(entities.symbols);
  const priorTurnCount = asArray(record.priorTurns).length;
  return {
    routeKind,
    ...(workflow ? { workflow } : {}),
    symbols,
    slotSources,
    priorTurnCount,
    ...(typeof record.savedStateIncluded === "boolean"
      ? { savedStateIncluded: record.savedStateIncluded }
      : {}),
    ...(attachmentCount !== undefined ? { attachmentCount } : {}),
  };
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
    upsertProviderGap(state.dataQuality.softGaps, provider, timestamp);
  }
  for (const provider of parseCredentialRequiredProviders(text)) {
    upsertProviderGap(state.dataQuality.hardSkips, provider, timestamp);
  }
  const provider = inferDirectToolGapProvider(message.toolName, text);
  if (provider) upsertProviderGap(state.dataQuality.softGaps, provider, timestamp);
}

function upsertProviderGap(
  gaps: Array<{ provider: string; lastSeen: string }>,
  provider: string,
  lastSeen: string,
): void {
  const existing = gaps.find((gap) => gap.provider === provider);
  if (!existing) {
    gaps.push({ provider, lastSeen });
    return;
  }

  const existingTime = Date.parse(existing.lastSeen);
  const nextTime = Date.parse(lastSeen);
  if (!Number.isFinite(existingTime) || (Number.isFinite(nextTime) && nextTime > existingTime)) {
    existing.lastSeen = lastSeen;
  }
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
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) return;
  addKnownSymbols(state, [normalizedSymbol]);

  const existing = state.watchlist.find((row) => row.symbol === normalizedSymbol);
  const row = {
    symbol: normalizedSymbol,
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
  while (true) {
    const match = re.exec(text);
    if (!match) break;
    providers.push(match[1]);
  }
  return providers;
}

function parseSkippedProviders(text: string): string[] {
  return parseSoftGapProviders(text);
}

function parseSoftGapProviders(text: string): string[] {
  const providers: string[] = [];
  const re =
    /\[OPENCANDLE_(?:SKIPPED|SOFT_DEGRADED|EXTERNAL_TOOL_REQUIRED)[^\]]*provider=([a-z0-9_-]+)/gi;
  while (true) {
    const match = re.exec(text);
    if (!match) break;
    providers.push(match[1]);
  }
  return providers;
}

function inferDirectToolGapProvider(
  toolName: string | undefined,
  text: string,
): string | undefined {
  if (!toolName || !/(?:⚠|unavailable|No .*data found|EXTERNAL_TOOL_SETUP)/i.test(text)) {
    return undefined;
  }
  return DIRECT_TOOL_GAP_PROVIDERS[toolName];
}

function inferSymbolFromContent(content: ToolResultMessage["content"]): string | undefined {
  const text = content.find((part) => part.type === "text")?.text;
  const match = text?.match(/^([A-Z]{1,8})\b/);
  return match?.[1];
}

function addKnownSymbols(state: DashboardState, values: unknown[]): void {
  for (const value of values) {
    const symbol = normalizeSymbol(value);
    if (!symbol || state.knownSymbols.includes(symbol)) continue;
    if (state.knownSymbols.length >= 100) return;
    state.knownSymbols.push(symbol);
  }
}

function normalizeSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized ? normalized : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
