import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { OptionsScreenerSlots, SlotResolution } from "../../../src/routing/types.js";
import type { EvidenceRecord } from "../../../src/runtime/evidence.js";
import { captureToolEvidence } from "../../../src/runtime/prompt-step.js";
import {
  disclosesNonLiveQuotes,
  extractQuoteStatusSummary,
  findNonLiveQuoteEvidence,
} from "../../../src/runtime/quote-freshness.js";
import { buildOptionsScreenerWorkflowDefinition } from "../../../src/workflows/options-screener.js";
import afterHoursFixture from "../../fixtures/yahoo/options-AAPL-after-hours.json";
import holidayClosedFixture from "../../fixtures/yahoo/options-AAPL-holiday-closed.json";
import regularFixture from "../../fixtures/yahoo/options-AAPL-regular.json";
import { optionChainToolResult } from "../../helpers/option-chain-results.js";

function sessionEntriesFor(result: unknown): SessionEntry[] {
  const record = result as { content: unknown; details: unknown };
  return [
    {
      type: "message",
      id: "a1",
      parentId: null,
      timestamp: "2026-05-21T02:05:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "call-1", name: "get_option_chain", arguments: {} }],
      },
    },
    {
      type: "message",
      id: "t1",
      parentId: "a1",
      timestamp: "2026-05-21T02:05:01.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "get_option_chain",
        content: record.content,
        details: record.details,
        isError: false,
      },
    },
  ] as unknown as SessionEntry[];
}

async function chainEvidence(fixture: unknown): Promise<EvidenceRecord[]> {
  return captureToolEvidence(sessionEntriesFor(await optionChainToolResult(fixture)));
}

function rankStepValidation(optionStrategy?: string) {
  const definition = buildOptionsScreenerWorkflowDefinition({
    resolved: {
      symbol: "TEST",
      direction: "bullish",
      ...(optionStrategy ? { optionStrategy } : {}),
      dteTarget: "25_to_45_days",
      objective: "balanced_leverage_and_probability",
      moneynessPreference: "atm_to_slightly_otm",
      liquidityMinimum: "high_open_interest_and_tight_spread",
    },
    sources: {},
    defaultsUsed: [],
    missingRequired: [],
  } as SlotResolution<OptionsScreenerSlots>);
  const validation = definition.steps[1].outputValidation;
  expect(validation, "rank_and_present must carry the quote-freshness gate").toBeDefined();
  return validation as NonNullable<typeof validation>;
}

const UNDISCLOSED = `| Strike | Expiry | Premium | Delta |
| --- | --- | --- | --- |
| $210 | 2026-06-19 | $4.80 | 0.42 |
Bottom line: buy the $210 call for a $480 premium per contract. Max loss = premium. Verify with your broker before trading.`;

const DISCLOSED = `| Strike | Expiry | Premium | Delta |
| --- | --- | --- | --- |
| $210 | 2026-06-19 | $4.80 | 0.42 |
These bid/ask figures are last-session quotes and are not executable now; recheck the premium after regular options trading opens.
Bottom line: the $210 call ranks first. Max loss = premium.`;

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

describe("options quote freshness disclosure", () => {
  it("does not accept a generic broker-verification line as a disclosure", () => {
    expect(disclosesNonLiveQuotes(UNDISCLOSED)).toBe(false);
    expect(disclosesNonLiveQuotes("Always verify with your broker before trading.")).toBe(false);
  });

  it.each([
    "Quotes are from the prior session and are not executable now.",
    "These are last-session bid/ask quotes.",
    "The chain was checked outside regular options trading, so premiums are stale.",
    "Premiums shown are indicative closing quotes, not live.",
    "The options market is closed; recheck bid/ask after the open.",
  ])("accepts an explicit non-live disclosure: %s", (text) => {
    expect(disclosesNonLiveQuotes(text)).toBe(true);
  });
});

describe("options_screener quote freshness gate", () => {
  it("fails an answer that presents non-live premiums without disclosure", async () => {
    const validation = rankStepValidation();
    const evidence = await chainEvidence(afterHoursFixture);
    const errors = validation.validate(UNDISCLOSED, {
      stepType: "rank_and_present",
      currentEvidence: [],
      priorEvidence: evidence,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("last_session_quotes");
    const repair = validation.repairPrompt(errors, {
      stepType: "rank_and_present",
      currentEvidence: [],
      priorEvidence: evidence,
    });
    expect(repair).toContain("Do not make new tool calls");
  });

  it("passes the same answer once the non-live quotes are disclosed", async () => {
    const evidence = await chainEvidence(afterHoursFixture);
    expect(
      rankStepValidation().validate(DISCLOSED, {
        stepType: "rank_and_present",
        currentEvidence: [],
        priorEvidence: evidence,
      }),
    ).toEqual([]);
  });

  it("never fires on live regular-session evidence or when no chain was captured", async () => {
    const evidence = await chainEvidence(regularFixture);
    const validation = rankStepValidation();
    expect(
      validation.validate(UNDISCLOSED, {
        stepType: "rank_and_present",
        currentEvidence: evidence,
        priorEvidence: [],
      }),
    ).toEqual([]);
    expect(validation.validate(UNDISCLOSED)).toEqual([]);
  });

  it("composes with the protective-put arithmetic gate without mixing repair prompts", async () => {
    const definition = buildOptionsScreenerWorkflowDefinition({
      resolved: {
        symbol: "TEST",
        direction: "bearish",
        optionStrategy: "protective_put",
        shareQuantity: 375,
        dteTarget: "25_to_45_days",
        objective: "balanced_leverage_and_probability",
        moneynessPreference: "atm_to_slightly_otm",
        liquidityMinimum: "high_open_interest_and_tight_spread",
      },
      sources: {},
      defaultsUsed: [],
      missingRequired: [],
    } as SlotResolution<OptionsScreenerSlots>);
    const validation = definition.steps[1].outputValidation;
    if (!validation) throw new Error("expected validation");
    const context = {
      stepType: "rank_and_present",
      currentEvidence: [],
      priorEvidence: await chainEvidence(afterHoursFixture),
    };
    const errors = validation.validate(UNDISCLOSED, context);
    expect(errors.some((error) => error.includes("last_session_quotes"))).toBe(true);
    expect(errors.some((error) => /sizing table/i.test(error))).toBe(true);
    const repair = validation.repairPrompt(errors, context);
    expect(repair).toContain("failed position-sizing or premium arithmetic validation");
    expect(repair).toContain("not live");
  });
});
