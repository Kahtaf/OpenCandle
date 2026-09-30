import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { captureToolEvidence } from "./prompt-step.js";
import { buildNonLiveQuoteNotice } from "./quote-freshness.js";

/** Custom message type of the non-live option quote notice (also its visible label). */
export const OPTION_QUOTE_NOTICE_TYPE = "Option quote notice";

/**
 * The non-live quote notice owed for the latest user turn: built from the
 * option-chain tool results after the latest user message, and undefined when
 * those chains were live or a notice already follows that message (so retries,
 * repeated settle boundaries, and reloads never duplicate it).
 */
export function quoteNoticeForTurn(entries: readonly SessionEntry[]): string | undefined {
  let start = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "message" && entry.message.role === "user") {
      start = i + 1;
      break;
    }
  }
  const turn = entries.slice(start);
  if (turn.some(isQuoteNotice)) return undefined;
  return buildNonLiveQuoteNotice(captureToolEvidence([...turn]));
}

export function isQuoteNotice(entry: SessionEntry): boolean {
  return (
    entry.type === "custom_message" &&
    (entry as { customType?: unknown }).customType === OPTION_QUOTE_NOTICE_TYPE
  );
}
