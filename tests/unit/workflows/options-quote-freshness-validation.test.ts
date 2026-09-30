import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { OptionsScreenerSlots, SlotResolution } from "../../../src/routing/types.js";
import type { EvidenceRecord } from "../../../src/runtime/evidence.js";
import { captureToolEvidence, combineOutputValidations } from "../../../src/runtime/prompt-step.js";
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

  // Compliant wording a model commonly uses; failing these would force a
  // needless repair or fail a workflow whose answer already disclosed.
  it.each([
    "Note: option quotes are delayed.",
    "Markets closed for the holiday; premiums below are reference only.",
    "Premiums are as of Friday's close.",
    "Bid/ask shown are not real-time.",
    "These quotes aren't live.",
    "The options market has closed for the day.",
    "Quotes are from the most recent session.",
    "Bid/ask figures cannot be executed until the market reopens.",
    "Recheck premiums at the open.",
    "Recheck premiums before the market opens.",
    "These are cached quotes from earlier today.",
    "After-hours quotes: premiums below may differ tomorrow.",
    "The options market is in after-hours trading.",
    "If you trade, note these are last-session quotes.",
    "Quotes are not live, so treat the premiums shown as a guide.",
    "If you trade, note these quotes are not live.",
    "Option data may be delayed.",
    "Stale quotes: recheck before trading.",
    "Premiums at 4.80 are stale.",
    "Prices as of the last close.",
    "Option prices are from the prior session.",
    "Premium: $4.80 per share as of the last close.",
    "Underlying prices are live, but option premiums shown are stale.",
    "Stock quotes are live; the option quotes are last-session quotes.",
    "The underlying is live but the option premiums are not live.",
    "The chain was fetched outside regular trading hours.",
    "The data may be delayed.",
    "These prices are from the prior session.",
    "The underlying is live, but option quotes come from a stale cache.",
  ])("accepts common non-live phrasing: %s", (text) => {
    expect(disclosesNonLiveQuotes(text)).toBe(true);
  });

  it.each([
    "These are not last-session quotes; the premiums are live.",
    "Premiums are not from the prior session.",
    "Quotes are not stale; premiums are live and executable.",
    "These quotes aren't delayed.",
    "Bid/ask are not closing quotes.",
    "The market is not closed.",
    "Live premium $3.20. Verify with your broker.",
    "If these quotes are stale, recheck them after the open; the premiums shown are live.",
    "If these quotes are stale, verify with your broker.",
    "Premiums may differ in case the market has closed.",
    "Quotes are last-session carryovers? No, the premiums above are executable now.",
    "Buy the $210 call at the market open for $4.80.",
    "Enter the order when the market opens.",
    "If these quotes are not live, recheck them tomorrow; the premium is 4.80.",
    "In case bid/ask are non-executable, use limit orders.",
    "The earnings release was delayed. The option premium is 4.80.",
    "Your thesis may be stale after earnings. The option premium is 4.80.",
    "Premiums are never delayed here.",
    "Underlying: $200 as of market close. Premium: $4.80.",
    "The stock price of $200 is from the prior session. Premium: $4.80.",
    "Earnings were reported after yesterday's close. Premium: $4.80.",
    "The underlying price is not live. The option premium is $4.80.",
    "Stock quotes are not real-time. Premium: $4.80.",
    "Option prices are live. The stock is from the prior session.",
    "The numbers shown are live. Quotes are from the prior session.",
    "Liquidity can deteriorate outside regular trading hours. Premium: $4.80.",
    "The underlying quote is from a stale cache. Option premium: $4.80.",
    "The stock data is delayed. Premium: $4.80.",
    "Recheck the stock price at the open. Premium: $4.80.",
    "Stock closing prices look weak. Premium: $4.80.",
    "The options market was closed yesterday but reopened today. Premium: $4.80.",
    "The market closed higher on Friday. Premium: $4.80.",
    "The option quotes listed above are live, although they are from the prior session.",
    "Premiums in the table are currently live; they are last-session quotes.",
    "Economic data may be delayed. Option premium: $4.80.",
    "Commodity prices are delayed. Option premium: $4.80.",
  ])("rejects negated, hypothetical, or contradicted non-live wording: %s", (text) => {
    expect(disclosesNonLiveQuotes(text)).toBe(false);
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

  it("does not fire on an answer that presents no quote figures", async () => {
    const evidence = await chainEvidence(afterHoursFixture);
    expect(
      rankStepValidation().validate("Fetched the option chain.", {
        stepType: "rank_and_present",
        currentEvidence: evidence,
        priorEvidence: [],
      }),
    ).toEqual([]);
  });

  it.each([
    "Premium: 480 per contract for the 210 call.",
    "Bid: 4 dollars on the 210 strike.",
    "| Strike | Premium |\n| 210 | 480 |",
    "The 210 call has a premium of 4.80 per share.",
    "The 210 call shows 4.80 bid.",
    "The 210 call costs 4.80 premium.",
    "The 210 call: 4.80 / 5.00 bid/ask.",
    "Buy the 210C at $4.80.",
    "| Strike | Last |\n| 210 | 4.80 |",
    "Last: 4.80 on the 210 call.",
    "Last price 4.80 for the 210 call.",
    "The 210 call trades at $4.80.",
    "| Strike | Expiry | Premium |\n| --- | --- | --- |\n| 210 | 2026-06-19 | 4.80 |",
  ])("treats integer premiums as quote figures: %s", async (text) => {
    const evidence = await chainEvidence(afterHoursFixture);
    expect(
      rankStepValidation().validate(text, {
        stepType: "rank_and_present",
        currentEvidence: evidence,
        priorEvidence: [],
      }),
    ).toHaveLength(1);
  });

  it.each([
    "Fetched the option chain.",
    "Fetched the chain for 2 expirations.",
    "No usable premium is available; require delta >= 0.20.",
    "Delta 0.42, IV 0.35, put/call ratio 0.85.",
    "No usable premium is available; conditional candidate: the $210 strike.",
    "Underlying: $200. No usable premium is available.",
    "The stock trades at $200; wait for a usable quote.",
    "No premium was available for 3 expirations.",
    "Bid/ask was missing on 12 contracts over 30 days.",
    "Premium cost would be about 5% of the position.",
    "The stock price is 200; no usable premium is available.",
    "Underlying price 200.15, no usable premium is available.",
    "| Strike | Expiry | Premium |\n| --- | --- | --- |\n| 210 | 2026-06-19 | N/A |",
  ])("does not treat a status line as quote figures: %s", async (text) => {
    const evidence = await chainEvidence(afterHoursFixture);
    expect(
      rankStepValidation().validate(text, {
        stepType: "fetch_chain",
        currentEvidence: evidence,
        priorEvidence: [],
      }),
    ).toEqual([]);
  });

  it("also gates the first user-visible step, which presents a ranked premium table", async () => {
    const definition = buildOptionsScreenerWorkflowDefinition({
      resolved: {
        symbol: "TEST",
        direction: "bullish",
        dteTarget: "25_to_45_days",
        objective: "balanced_leverage_and_probability",
        moneynessPreference: "atm_to_slightly_otm",
        liquidityMinimum: "high_open_interest_and_tight_spread",
      },
      sources: {},
      defaultsUsed: [],
      missingRequired: [],
    } as SlotResolution<OptionsScreenerSlots>);
    const validation = definition.steps[0].outputValidation;
    if (!validation) throw new Error("fetch_chain must carry the quote-freshness gate");
    const context = {
      stepType: "fetch_chain",
      currentEvidence: await chainEvidence(afterHoursFixture),
      priorEvidence: [],
    };
    expect(validation.validate(UNDISCLOSED, context)).toHaveLength(1);
    expect(validation.validate(DISCLOSED, context)).toEqual([]);
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

describe("combineOutputValidations", () => {
  const first = {
    validate: () => ["a"],
    repairPrompt: (errors: string[]) => `first:${errors.join(",")}`,
  };
  const second = {
    validate: () => [],
    repairPrompt: (errors: string[]) => `second:${errors.join(",")}`,
  };

  it("returns a lone validator unchanged and undefined when none apply", () => {
    expect(combineOutputValidations(undefined, first)).toBe(first);
    expect(combineOutputValidations(undefined)).toBeUndefined();
  });

  it("repairs only the failing validator for errors it produced", () => {
    const combined = combineOutputValidations(first, second);
    const errors = combined?.validate("text") ?? [];
    expect(errors).toEqual(["a"]);
    expect(combined?.repairPrompt(errors)).toBe("first:a");
  });

  it("falls back to every validator for errors it did not produce", () => {
    expect(combineOutputValidations(first, second)?.repairPrompt(["x"])).toBe(
      "first:x\n\nsecond:x",
    );
  });
});
