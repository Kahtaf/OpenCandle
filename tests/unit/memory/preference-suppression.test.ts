import { describe, expect, it } from "vitest";
import { preferenceKeysForOverriddenSlots } from "../../../src/memory/preference-suppression.js";

describe("preference suppression", () => {
  it("maps overridden workflow slots to all affected preference keys", () => {
    expect(
      preferenceKeysForOverriddenSlots(["riskProfile", "liquidityMinimum", "unknown"]),
    ).toEqual(new Set(["risk_profile", "liquidity_minimum", "options_liquidity"]));
    expect(preferenceKeysForOverriddenSlots()).toEqual(new Set());
  });
});
