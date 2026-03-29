import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  recordPrediction,
  checkPredictions,
  type Prediction,
} from "../../../src/tools/portfolio/predictions.js";
import * as fs from "node:fs";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

describe("recordPrediction", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue("[]");
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves a prediction with required fields", () => {
    recordPrediction({
      symbol: "AAPL",
      direction: "bullish",
      conviction: 8,
      entryPrice: 180,
      timeframeDays: 30,
    });

    expect(fs.writeFileSync).toHaveBeenCalled();
    const written: Prediction[] = JSON.parse(
      vi.mocked(fs.writeFileSync).mock.calls[0][1] as string,
    );
    expect(written).toHaveLength(1);
    expect(written[0].symbol).toBe("AAPL");
    expect(written[0].direction).toBe("bullish");
    expect(written[0].conviction).toBe(8);
    expect(written[0].entryPrice).toBe(180);
    expect(written[0]).toHaveProperty("date");
    expect(written[0]).toHaveProperty("expiresAt");
  });

  it("appends to existing predictions", () => {
    const existing: Prediction[] = [
      {
        symbol: "MSFT",
        direction: "bearish",
        conviction: 6,
        entryPrice: 400,
        date: "2026-03-01",
        expiresAt: "2026-03-31",
        timeframeDays: 30,
      },
    ];
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing));

    recordPrediction({
      symbol: "AAPL",
      direction: "bullish",
      conviction: 8,
      entryPrice: 180,
      timeframeDays: 30,
    });

    const written: Prediction[] = JSON.parse(
      vi.mocked(fs.writeFileSync).mock.calls[0][1] as string,
    );
    expect(written).toHaveLength(2);
  });
});

describe("checkPredictions", () => {
  it("computes hit rate for resolved predictions", () => {
    const predictions: Prediction[] = [
      {
        symbol: "AAPL",
        direction: "bullish",
        conviction: 8,
        entryPrice: 180,
        date: "2026-01-01",
        expiresAt: "2026-01-31",
        timeframeDays: 30,
      },
      {
        symbol: "MSFT",
        direction: "bearish",
        conviction: 6,
        entryPrice: 400,
        date: "2026-01-01",
        expiresAt: "2026-01-31",
        timeframeDays: 30,
      },
    ];

    const currentPrices = new Map([
      ["AAPL", 200], // went up → bullish was correct
      ["MSFT", 420], // went up → bearish was wrong
    ]);

    const result = checkPredictions(predictions, currentPrices);
    expect(result.total).toBe(2);
    expect(result.correct).toBe(1);
    expect(result.hitRate).toBeCloseTo(0.5, 2);
  });

  it("computes weighted hit rate by conviction", () => {
    const predictions: Prediction[] = [
      {
        symbol: "AAPL",
        direction: "bullish",
        conviction: 10, // high conviction, correct
        entryPrice: 180,
        date: "2026-01-01",
        expiresAt: "2026-01-31",
        timeframeDays: 30,
      },
      {
        symbol: "MSFT",
        direction: "bearish",
        conviction: 2, // low conviction, wrong
        entryPrice: 400,
        date: "2026-01-01",
        expiresAt: "2026-01-31",
        timeframeDays: 30,
      },
    ];

    const currentPrices = new Map([
      ["AAPL", 200],
      ["MSFT", 420],
    ]);

    const result = checkPredictions(predictions, currentPrices);
    // Weighted: 10/(10+2) correct = 83%
    expect(result.weightedHitRate).toBeGreaterThan(result.hitRate);
  });

  it("correctly identifies bullish prediction as hit when price rises", () => {
    const predictions: Prediction[] = [
      {
        symbol: "AAPL",
        direction: "bullish",
        conviction: 7,
        entryPrice: 100,
        date: "2026-01-01",
        expiresAt: "2026-01-31",
        timeframeDays: 30,
      },
    ];

    const result = checkPredictions(predictions, new Map([["AAPL", 110]]));
    expect(result.correct).toBe(1);
  });

  it("correctly identifies bearish prediction as hit when price falls", () => {
    const predictions: Prediction[] = [
      {
        symbol: "AAPL",
        direction: "bearish",
        conviction: 7,
        entryPrice: 100,
        date: "2026-01-01",
        expiresAt: "2026-01-31",
        timeframeDays: 30,
      },
    ];

    const result = checkPredictions(predictions, new Map([["AAPL", 90]]));
    expect(result.correct).toBe(1);
  });

  it("handles empty predictions list", () => {
    const result = checkPredictions([], new Map());
    expect(result.total).toBe(0);
    expect(result.hitRate).toBe(0);
  });

  it("does not score predictions that have not yet expired", () => {
    const predictions: Prediction[] = [
      {
        symbol: "AAPL",
        direction: "bullish",
        conviction: 8,
        entryPrice: 180,
        date: "2026-03-01",
        expiresAt: "2026-04-30", // still open
        timeframeDays: 60,
      },
    ];

    const result = checkPredictions(
      predictions,
      new Map([["AAPL", 200]]),
      new Date("2026-03-29"),
    );
    expect(result.open).toBe(1);
    expect(result.correct).toBe(0);
    expect(result.wrong).toBe(0);
  });

  it("scores expired predictions", () => {
    const predictions: Prediction[] = [
      {
        symbol: "AAPL",
        direction: "bullish",
        conviction: 8,
        entryPrice: 180,
        date: "2026-01-01",
        expiresAt: "2026-01-31", // expired
        timeframeDays: 30,
      },
    ];

    const result = checkPredictions(
      predictions,
      new Map([["AAPL", 200]]),
      new Date("2026-03-29"),
    );
    expect(result.open).toBe(0);
    expect(result.correct).toBe(1);
  });

  it("hitRate excludes open predictions", () => {
    const predictions: Prediction[] = [
      {
        symbol: "AAPL",
        direction: "bullish",
        conviction: 8,
        entryPrice: 180,
        date: "2026-01-01",
        expiresAt: "2026-01-31", // expired, correct
        timeframeDays: 30,
      },
      {
        symbol: "MSFT",
        direction: "bullish",
        conviction: 6,
        entryPrice: 400,
        date: "2026-03-01",
        expiresAt: "2026-04-30", // still open
        timeframeDays: 60,
      },
    ];

    const result = checkPredictions(
      predictions,
      new Map([["AAPL", 200], ["MSFT", 380]]),
      new Date("2026-03-29"),
    );
    expect(result.open).toBe(1);
    expect(result.correct).toBe(1);
    expect(result.wrong).toBe(0);
    // hitRate = 1/1 = 100% (only scored the expired one)
    expect(result.hitRate).toBe(1.0);
  });
});
