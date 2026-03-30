import { describe, it, expect } from "vitest";
import { extractPreferences } from "../../../src/memory/preference-extractor.js";

describe("extractPreferences", () => {
  it("extracts asset scope from 'I prefer ETFs over individual stocks'", () => {
    const prefs = extractPreferences("I prefer ETFs over individual stocks");
    expect(prefs).toHaveLength(1);
    expect(prefs[0].key).toBe("asset_scope");
    expect(prefs[0].value).toBe("etf_focused");
    expect(prefs[0].confidence).toBe("high");
  });

  it("extracts risk profile from 'I'm conservative'", () => {
    const prefs = extractPreferences("I'm conservative");
    expect(prefs).toHaveLength(1);
    expect(prefs[0].key).toBe("risk_profile");
    expect(prefs[0].value).toBe("conservative");
  });

  it("extracts risk profile from 'I'm pretty risk averse'", () => {
    const prefs = extractPreferences("I'm pretty risk averse");
    expect(prefs).toHaveLength(1);
    expect(prefs[0].key).toBe("risk_profile");
    expect(prefs[0].value).toBe("conservative");
  });

  it("extracts risk profile from 'aggressive growth'", () => {
    const prefs = extractPreferences("I like aggressive growth");
    expect(prefs).toHaveLength(1);
    expect(prefs[0].key).toBe("risk_profile");
    expect(prefs[0].value).toBe("aggressive");
  });

  it("extracts time horizon from 'Use 12 month horizons'", () => {
    const prefs = extractPreferences("Use 12 month horizons unless I say otherwise");
    expect(prefs).toHaveLength(1);
    expect(prefs[0].key).toBe("time_horizon");
    expect(prefs[0].value).toBe("1y_plus");
  });

  it("extracts liquidity preference from 'I only trade liquid options'", () => {
    const prefs = extractPreferences("I only trade liquid options");
    expect(prefs).toHaveLength(1);
    expect(prefs[0].key).toBe("options_liquidity");
    expect(prefs[0].value).toBe("high");
  });

  it("returns nothing for 'analyze NVDA'", () => {
    const prefs = extractPreferences("analyze NVDA");
    expect(prefs).toHaveLength(0);
  });

  it("returns nothing for 'best MSFT calls'", () => {
    const prefs = extractPreferences("best MSFT calls a month out");
    expect(prefs).toHaveLength(0);
  });

  it("extracts multiple preferences from compound statement", () => {
    const prefs = extractPreferences(
      "I'm conservative and prefer ETFs",
    );
    expect(prefs.length).toBeGreaterThanOrEqual(2);
    const keys = prefs.map((p) => p.key);
    expect(keys).toContain("risk_profile");
    expect(keys).toContain("asset_scope");
  });
});
