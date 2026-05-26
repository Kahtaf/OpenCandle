import { describe, expect, it } from "vitest";
import { classifyWithLegacyRules } from "../../../src/routing/legacy-rule-router.js";

describe("legacy rule router boundary", () => {
  it("exposes deterministic classification under a legacy rollback/safety-net name", () => {
    const result = classifyWithLegacyRules("analyze NVDA");

    expect(result.workflow).toBe("single_asset_analysis");
    expect(result.tier).toBe("rule");
  });
});
