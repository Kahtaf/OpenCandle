import { describe, expect, it } from "vitest";
import { topCashtagMentions } from "../../../src/providers/social-mentions.js";

describe("social cashtag aggregation", () => {
  it("ranks cashtags by frequency and can exclude the searched ticker", () => {
    expect(
      topCashtagMentions(["$AAPL and $TSLA", "$TSLA then $NVDA", "$TSLA $AAPL"], {
        exclude: "AAPL",
        limit: 2,
      }),
    ).toEqual(["TSLA", "NVDA"]);
  });
});
