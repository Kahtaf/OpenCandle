import { describe, expect, it } from "vitest";
import {
  OPTIONS_SCREENER_DEFAULTS,
  PORTFOLIO_DEFAULTS,
  parseDteTarget,
} from "../../../src/routing/defaults.js";

describe("PORTFOLIO_DEFAULTS", () => {
  it("has balanced risk profile", () => {
    expect(PORTFOLIO_DEFAULTS.riskProfile).toBe("balanced");
  });

  it("has 1y+ time horizon", () => {
    expect(PORTFOLIO_DEFAULTS.timeHorizon).toBe("1y_plus");
  });

  it("defaults to diversified ETF building blocks", () => {
    expect(PORTFOLIO_DEFAULTS.assetScope).toBe("diversified_etf_building_blocks");
  });

  it("has 6 positions", () => {
    expect(PORTFOLIO_DEFAULTS.positionCount).toBe(6);
  });

  it("has 20% max single position", () => {
    expect(PORTFOLIO_DEFAULTS.maxSinglePositionPct).toBe(20);
  });
});

describe("OPTIONS_SCREENER_DEFAULTS", () => {
  it("has 25-45 day DTE target", () => {
    expect(OPTIONS_SCREENER_DEFAULTS.dteTarget).toBe("25_to_45_days");
  });

  it("has balanced objective", () => {
    expect(OPTIONS_SCREENER_DEFAULTS.objective).toBe("balanced_leverage_and_probability");
  });

  it("has ATM to slightly OTM moneyness", () => {
    expect(OPTIONS_SCREENER_DEFAULTS.moneynessPreference).toBe("atm_to_slightly_otm");
  });

  it("has high liquidity minimum", () => {
    expect(OPTIONS_SCREENER_DEFAULTS.liquidityMinimum).toBe("high_open_interest_and_tight_spread");
  });
});

describe("parseDteTarget", () => {
  it("parses '25_to_45_days'", () => {
    expect(parseDteTarget("25_to_45_days")).toEqual({ minDays: 25, maxDays: 45 });
  });

  it("parses '7_to_14_days'", () => {
    expect(parseDteTarget("7_to_14_days")).toEqual({ minDays: 7, maxDays: 14 });
  });

  it("parses '180_plus_days'", () => {
    const result = parseDteTarget("180_plus_days");
    expect(result).toBeTruthy();
    expect(result?.minDays).toBe(180);
    expect(result?.maxDays).toBe(1095);
  });

  it("returns null for unrecognized format", () => {
    expect(parseDteTarget("unknown")).toBeNull();
  });
});
