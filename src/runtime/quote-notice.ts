import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { classifyMarketStatusAt } from "../infra/market-calendar.js";
import type { EvidenceRecord } from "./evidence.js";
import { captureToolEvidence } from "./prompt-step.js";
import { buildNonLiveQuoteNotice, extractQuoteStatusSummary } from "./quote-freshness.js";

/** Custom message type of the non-live option quote notice (also its visible label). */
export const OPTION_QUOTE_NOTICE_TYPE = "Option quote notice";

/**
 * The non-live quote notice owed for the latest user turn, or undefined when
 * none is owed. Derived only from option-chain tool results, never from the
 * model's wording:
 *
 * - A turn that fetched option chains is judged by those chains.
 * - A follow-up that fetched none but is routed to a symbol whose chain an
 *   earlier turn fetched is judged by that earlier chain, revalidated against
 *   the current session: a chain that was live when fetched is not live once
 *   the regular session has ended.
 * - Nothing is owed once a notice already follows the latest user message, so
 *   retries, repeated settle boundaries, and reloads never duplicate it.
 */
export function quoteNoticeForTurn(
  entries: readonly SessionEntry[],
  now: Date = new Date(),
): string | undefined {
  const start = latestUserMessageIndex(entries) + 1;
  const turn = entries.slice(start);
  if (turn.some(isQuoteNotice)) return undefined;
  const current = captureToolEvidence([...turn]).filter(hasQuoteStatus);
  if (current.length > 0) return buildNonLiveQuoteNotice(current);
  const symbols = routedSymbols(entries);
  if (symbols.size === 0) return undefined;
  const carried = earlierChainEvidence(entries.slice(0, start), symbols);
  if (carried.length === 0) return undefined;
  return buildNonLiveQuoteNotice(revalidateForSession(carried, currentOptionsSession(now)));
}

export function isQuoteNotice(entry: SessionEntry): boolean {
  return (
    entry.type === "custom_message" &&
    (entry as { customType?: unknown }).customType === OPTION_QUOTE_NOTICE_TYPE
  );
}

function latestUserMessageIndex(entries: readonly SessionEntry[]): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "message" && entry.message.role === "user") return i;
  }
  return -1;
}

function hasQuoteStatus(record: EvidenceRecord): boolean {
  return extractQuoteStatusSummary(record.value) !== undefined;
}

/** Symbols the router resolved for the latest turn (its route-context entry). */
function routedSymbols(entries: readonly SessionEntry[]): Set<string> {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as { type: string; customType?: unknown; data?: unknown };
    if (entry.type !== "custom" || entry.customType !== "opencandle-route-context") continue;
    const entities = asRecord(asRecord(entry.data).entities);
    const symbols = Array.isArray(entities.symbols) ? entities.symbols : [];
    return new Set(
      symbols.filter((s): s is string => typeof s === "string").map((s) => s.toUpperCase()),
    );
  }
  return new Set();
}

/**
 * Evidence from the most recent earlier turn that fetched an option chain for
 * one of `symbols`, limited to those symbols' chains.
 */
function earlierChainEvidence(
  earlier: readonly SessionEntry[],
  symbols: ReadonlySet<string>,
): EvidenceRecord[] {
  for (let end = earlier.length; end > 0; ) {
    const start = latestUserMessageIndex(earlier.slice(0, end)) + 1;
    const turn = earlier.slice(start, end).filter((entry) => {
      if (entry.type !== "message" || entry.message.role !== "toolResult") return true;
      const symbol = asRecord((entry.message as { details?: unknown }).details).symbol;
      return typeof symbol === "string" && symbols.has(symbol.toUpperCase());
    });
    const evidence = captureToolEvidence(turn).filter(hasQuoteStatus);
    if (evidence.length > 0) return evidence;
    end = start - 1;
  }
  return [];
}

type OptionsSession = "pre_market" | "regular" | "after_hours" | "closed";

function currentOptionsSession(now: Date): OptionsSession {
  switch (classifyMarketStatusAt(now)) {
    case "pre_market":
      return "pre_market";
    case "open":
      return "regular";
    case "after_close":
    case "closed_after_hours":
      return "after_hours";
    default:
      return "closed";
  }
}

/**
 * Restate carried chain evidence as of the current session: quotes that were
 * live when fetched are carried over from the last regular session once that
 * session has ended.
 */
function revalidateForSession(
  records: readonly EvidenceRecord[],
  session: OptionsSession,
): EvidenceRecord[] {
  return records.map((record) => {
    const value = asRecord(record.value);
    const status = asRecord(value.quoteStatus);
    let bidAskState = status.bidAskState;
    if (session !== "regular" && bidAskState === "live_quotes") bidAskState = "last_session_quotes";
    if (session !== "regular" && bidAskState === "live_zero_bid_ask") {
      bidAskState = "closed_market_or_stale_quotes";
    }
    return {
      ...record,
      value: { ...value, quoteStatus: { ...status, marketSession: session, bidAskState } },
    };
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
