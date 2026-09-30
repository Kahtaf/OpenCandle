import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "../../../src/runtime/evidence.js";
import { captureToolEvidence } from "../../../src/runtime/prompt-step.js";
import {
  buildNonLiveQuoteNotice,
  extractQuoteStatusSummary,
  findNonLiveQuoteEvidence,
} from "../../../src/runtime/quote-freshness.js";
import { OPTION_QUOTE_NOTICE_TYPE, quoteNoticeForTurn } from "../../../src/runtime/quote-notice.js";
import afterHoursFixture from "../../fixtures/yahoo/options-AAPL-after-hours.json";
import holidayClosedFixture from "../../fixtures/yahoo/options-AAPL-holiday-closed.json";
import regularFixture from "../../fixtures/yahoo/options-AAPL-regular.json";
import { optionChainToolResult } from "../../helpers/option-chain-results.js";

function chainEntries(result: unknown, suffix = "1"): SessionEntry[] {
  const record = result as { content: unknown; details: unknown };
  return [
    {
      type: "message",
      id: `a${suffix}`,
      parentId: null,
      timestamp: "2026-05-21T02:05:00.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: `call-${suffix}`, name: "get_option_chain", arguments: {} },
        ],
      },
    },
    {
      type: "message",
      id: `t${suffix}`,
      parentId: `a${suffix}`,
      timestamp: "2026-05-21T02:05:01.000Z",
      message: {
        role: "toolResult",
        toolCallId: `call-${suffix}`,
        toolName: "get_option_chain",
        content: record.content,
        details: record.details,
        isError: false,
      },
    },
  ] as unknown as SessionEntry[];
}

function userEntry(id: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-05-21T02:04:00.000Z",
    message: { role: "user", content: "Find AAPL calls" },
  } as unknown as SessionEntry;
}

function noticeEntry(id: string): SessionEntry {
  return {
    type: "custom_message",
    id,
    parentId: null,
    timestamp: "2026-05-21T02:06:00.000Z",
    customType: OPTION_QUOTE_NOTICE_TYPE,
    content: "notice",
    display: true,
  } as unknown as SessionEntry;
}

async function chainEvidence(fixture: unknown): Promise<EvidenceRecord[]> {
  return captureToolEvidence(chainEntries(await optionChainToolResult(fixture)));
}

/** The holiday chain with every bid/ask zeroed: an unquoted closed market. */
function zeroBidAsk(fixture: unknown): unknown {
  const copy = structuredClone(fixture) as {
    optionChain: { result: { options: { calls: object[]; puts: object[] }[] }[] };
  };
  for (const result of copy.optionChain.result) {
    for (const option of result.options) {
      for (const contract of [...option.calls, ...option.puts]) {
        Object.assign(contract, { bid: 0, ask: 0 });
      }
    }
  }
  return copy;
}

function withStaleCache(records: EvidenceRecord[]): EvidenceRecord[] {
  return records.map((record) => {
    const value = record.value as Record<string, unknown>;
    return {
      ...record,
      value: { ...value, freshness: { ...(value.freshness as object), cacheStatus: "stale" } },
    };
  });
}

describe("options quote freshness evidence", () => {
  it("keeps quote status on captured after-hours option-chain evidence", async () => {
    const [record] = await chainEvidence(afterHoursFixture);
    const summary = extractQuoteStatusSummary(record.value);
    expect(summary).toMatchObject({
      bidAskState: "last_session_quotes",
      marketSession: "after_hours",
      marketSessionSource: "provider_market_state",
      providerMarketState: "POST",
    });
    expect(findNonLiveQuoteEvidence([record])).toHaveLength(1);
  });

  it("treats all-zero closed-market chains as non-live and regular live chains as live", async () => {
    const closed = await chainEvidence(holidayClosedFixture);
    const live = await chainEvidence(regularFixture);
    expect(findNonLiveQuoteEvidence(closed)).toHaveLength(1);
    expect(extractQuoteStatusSummary(live[0].value)?.bidAskState).toBe("live_quotes");
    expect(findNonLiveQuoteEvidence(live)).toEqual([]);
  });
});

describe("non-live option quote notice", () => {
  it("states the session and that last-session prices are not executable", async () => {
    expect(buildNonLiveQuoteNotice(await chainEvidence(afterHoursFixture))).toBe(
      "Options market is after hours. Option prices shown are from the last regular session and are not executable now.",
    );
  });

  it("explains unquoted bid/ask on a closed market", async () => {
    expect(buildNonLiveQuoteNotice(await chainEvidence(zeroBidAsk(holidayClosedFixture)))).toBe(
      "Options market is closed. Option bid/ask were not quoted, so recheck prices during regular trading.",
    );
  });

  it("flags live-session quotes served from a stale cache", async () => {
    expect(buildNonLiveQuoteNotice(withStaleCache(await chainEvidence(regularFixture)))).toBe(
      "Option prices shown came from cached data after a provider error and are not live.",
    );
  });

  it("adds nothing for live evidence or when no chain was fetched", async () => {
    expect(buildNonLiveQuoteNotice(await chainEvidence(regularFixture))).toBeUndefined();
    expect(buildNonLiveQuoteNotice([])).toBeUndefined();
  });

  it("states each fact once across several non-live chains and uses no em dashes", async () => {
    const evidence = [
      ...(await chainEvidence(afterHoursFixture)),
      ...(await chainEvidence(afterHoursFixture)),
    ];
    const notice = buildNonLiveQuoteNotice(evidence) ?? "";
    expect(notice.match(/last regular session/g)).toHaveLength(1);
    expect(notice).not.toMatch(/\u2014|\u2013/);
  });
});

describe("quoteNoticeForTurn", () => {
  it("returns the notice for non-live chain results after the latest user message", async () => {
    const entries = [
      userEntry("u1"),
      ...chainEntries(await optionChainToolResult(afterHoursFixture)),
    ];
    expect(quoteNoticeForTurn(entries)).toContain("not executable now");
  });

  it("ignores chains fetched before the latest user message", async () => {
    const entries = [
      userEntry("u1"),
      ...chainEntries(await optionChainToolResult(afterHoursFixture)),
      userEntry("u2"),
    ];
    expect(quoteNoticeForTurn(entries)).toBeUndefined();
  });

  it("is idempotent: no second notice once one follows the latest user message", async () => {
    const entries = [
      userEntry("u1"),
      ...chainEntries(await optionChainToolResult(afterHoursFixture)),
      noticeEntry("n1"),
    ];
    expect(quoteNoticeForTurn(entries)).toBeUndefined();
  });

  it("returns nothing for a live regular-session chain", async () => {
    const entries = [userEntry("u1"), ...chainEntries(await optionChainToolResult(regularFixture))];
    expect(quoteNoticeForTurn(entries)).toBeUndefined();
  });
});
