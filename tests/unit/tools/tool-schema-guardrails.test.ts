import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { fredDataTool } from "../../../src/tools/macro/fred-data.js";
import { stockHistoryTool } from "../../../src/tools/market/stock-history.js";
import { optionChainTool } from "../../../src/tools/options/option-chain.js";
import { alertsTool } from "../../../src/tools/portfolio/alerts.js";
import { correlationTool } from "../../../src/tools/portfolio/correlation.js";
import { riskAnalysisTool } from "../../../src/tools/portfolio/risk-analysis.js";
import { portfolioTrackerTool } from "../../../src/tools/portfolio/tracker.js";
import { backtestTool } from "../../../src/tools/technical/backtest.js";

describe("tool schema guardrails", () => {
  it("rejects free-form stock history range and interval values", () => {
    expect(Value.Check(stockHistoryTool.parameters, { symbol: "AAPL", range: "1w" })).toBe(false);
    expect(Value.Check(stockHistoryTool.parameters, { symbol: "AAPL", interval: "2h" })).toBe(
      false,
    );
    expect(
      Value.Check(stockHistoryTool.parameters, { symbol: "AAPL", range: "1y", interval: "1d" }),
    ).toBe(true);
    expect(Value.Check(stockHistoryTool.parameters, { symbol: "AAPL", range: "ytd" })).toBe(true);
    expect(Value.Check(stockHistoryTool.parameters, { symbol: "AAPL", range: "10y" })).toBe(true);
  });

  it("rejects free-form history periods before provider calls", () => {
    expect(
      Value.Check(correlationTool.parameters, { symbols: ["AAPL", "MSFT"], period: "1w" }),
    ).toBe(false);
    expect(
      Value.Check(correlationTool.parameters, { symbols: ["AAPL", "MSFT"], period: "2y" }),
    ).toBe(true);
    expect(Value.Check(riskAnalysisTool.parameters, { symbol: "AAPL", period: "max" })).toBe(false);
    expect(Value.Check(riskAnalysisTool.parameters, { symbol: "AAPL", period: "6mo" })).toBe(true);
    expect(
      Value.Check(backtestTool.parameters, {
        symbol: "AAPL",
        strategy: "sma_crossover",
        period: "6mo",
      }),
    ).toBe(false);
    expect(
      Value.Check(backtestTool.parameters, {
        symbol: "AAPL",
        strategy: "sma_crossover",
        period: "5y",
      }),
    ).toBe(true);
  });

  it("rejects malformed options expiration dates before provider calls", () => {
    expect(
      Value.Check(optionChainTool.parameters, { symbol: "AAPL", expiration: "next Friday" }),
    ).toBe(false);
    expect(
      Value.Check(optionChainTool.parameters, { symbol: "AAPL", expiration: "2026-06-19" }),
    ).toBe(true);
  });

  it("bounds FRED observation limits", () => {
    expect(Value.Check(fredDataTool.parameters, { series_id: "CPIAUCSL", limit: 0 })).toBe(false);
    expect(Value.Check(fredDataTool.parameters, { series_id: "CPIAUCSL", limit: 1001 })).toBe(
      false,
    );
    expect(Value.Check(fredDataTool.parameters, { series_id: "CPIAUCSL", limit: 30 })).toBe(true);
  });

  it("bounds portfolio numeric mutation fields", () => {
    expect(
      Value.Check(portfolioTrackerTool.parameters, {
        action: "add",
        symbol: "AAPL",
        shares: 0,
        avg_cost: 100,
      }),
    ).toBe(false);
    expect(
      Value.Check(portfolioTrackerTool.parameters, {
        action: "add",
        symbol: "AAPL",
        shares: 1,
        avg_cost: 0,
      }),
    ).toBe(false);
    expect(
      Value.Check(portfolioTrackerTool.parameters, {
        action: "update",
        lot_id: 1,
        shares: 1,
      }),
    ).toBe(true);
  });

  it("requires integer SMA-cross alert lookback periods", () => {
    expect(
      Value.Check(alertsTool.parameters, {
        action: "create_price_above_sma",
        symbol: "AAPL",
        period: 2.5,
      }),
    ).toBe(false);
    expect(
      Value.Check(alertsTool.parameters, {
        action: "create_price_above_sma",
        symbol: "AAPL",
        period: 2,
      }),
    ).toBe(true);
    expect(
      Value.Check(alertsTool.parameters, {
        action: "create_sma_cross_above",
        symbol: "AAPL",
        fast_period: 2.5,
        slow_period: 5,
      }),
    ).toBe(false);
    expect(
      Value.Check(alertsTool.parameters, {
        action: "create_sma_cross_above",
        symbol: "AAPL",
        fast_period: 2,
        slow_period: 5,
      }),
    ).toBe(true);
  });

  it("allows zero alert cooldowns but rejects negative cooldowns", () => {
    expect(
      Value.Check(alertsTool.parameters, {
        action: "create_price_above",
        symbol: "AAPL",
        threshold: 250,
        cooldown_seconds: -1,
      }),
    ).toBe(false);
    expect(
      Value.Check(alertsTool.parameters, {
        action: "create_price_above",
        symbol: "AAPL",
        threshold: 250,
        cooldown_seconds: 0,
      }),
    ).toBe(true);
  });
});
