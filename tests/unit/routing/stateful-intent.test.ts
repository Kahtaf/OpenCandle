import { describe, expect, it } from "vitest";
import { isStatefulTrackingRequest } from "../../../src/routing/stateful-intent.js";

describe("stateful tracking intent", () => {
  it("recognizes state mutations and portfolio lot recording", () => {
    expect(isStatefulTrackingRequest("add AAPL to my watchlist")).toBe(true);
    expect(isStatefulTrackingRequest("record 25 shares of MSFT in my holdings")).toBe(true);
    expect(isStatefulTrackingRequest("show my alert history")).toBe(true);
  });

  it("does not intercept funded portfolio construction", () => {
    expect(isStatefulTrackingRequest("build a portfolio with a $10,000 budget")).toBe(false);
  });
});
