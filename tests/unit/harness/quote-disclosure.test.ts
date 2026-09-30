import { describe, expect, it } from "vitest";
import { disclosesNonLiveQuotes } from "../../harness/quote-disclosure.js";

const UNDISCLOSED = `| Strike | Expiry | Premium | Delta |
| --- | --- | --- | --- |
| $210 | 2026-06-19 | $4.80 | 0.42 |
Bottom line: buy the $210 call for a $480 premium per contract. Max loss = premium. Verify with your broker before trading.`;

// Eval-side measurement only: production never gates on this wording.
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
    "Verify live bid/ask with your broker; these are last-session quotes.",
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
    "These are live option quotes; however, these are last-session quotes. Premium: $4.80.",
    "They are executable premiums, from the prior session.",
  ])("rejects negated, hypothetical, or contradicted non-live wording: %s", (text) => {
    expect(disclosesNonLiveQuotes(text)).toBe(false);
  });
});
