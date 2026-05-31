import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  predictionsTool,
  recordPrediction,
  checkPredictions,
  type Prediction,
} from "../../../src/tools/portfolio/predictions.js";
import { getQuote } from "../../../src/providers/yahoo-finance.js";
import { httpGet } from "../../../src/infra/http-client.js";
import type { StockQuote } from "../../../src/types/market.js";
import { initDefaultDatabase } from "../../../src/memory/sqlite.js";
import { MarketStateService } from "../../../src/market-state/service.js";

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
}));
vi.mock("../../../src/infra/http-client.js", () => ({
  httpGet: vi.fn(),
}));

describe("recordPrediction", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-predictions-test-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
    vi.mocked(getQuote).mockImplementation(async (symbol: string) =>
      quote(symbol.toUpperCase(), symbol.toUpperCase() === "MSFT" ? 400 : 180),
    );
    vi.mocked(httpGet).mockResolvedValue({ quotes: [] });
  });

  afterEach(() => {
    if (originalEnv == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalEnv;
    }
    rmSync(openCandleHome, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("saves a prediction with required fields in SQLite", async () => {
    const prediction = await recordPrediction({
      symbol: "AAPL",
      direction: "bullish",
      conviction: 8,
      entryPrice: 180,
      timeframeDays: 30,
    });

    expect(prediction.id).toEqual(expect.any(Number));
    expect(prediction.instrumentId).toEqual(expect.any(Number));
    expect(prediction.symbol).toBe("AAPL");
    expect(prediction.direction).toBe("bullish");
    expect(prediction.conviction).toBe(8);
    expect(prediction.entryPrice).toBe(180);
    expect(prediction).toHaveProperty("date");
    expect(prediction).toHaveProperty("expiresAt");
    expect(existsSync(join(openCandleHome, "state.db"))).toBe(true);
    expect(existsSync(join(openCandleHome, "predictions.json"))).toBe(false);
  });

  it("appends to existing predictions", async () => {
    await recordPrediction({
      symbol: "MSFT",
      direction: "bearish",
      conviction: 6,
      entryPrice: 400,
      timeframeDays: 30,
    });

    const prediction = await recordPrediction({
      symbol: "AAPL",
      direction: "bullish",
      conviction: 8,
      entryPrice: 180,
      timeframeDays: 30,
    });

    expect(prediction.symbol).toBe("AAPL");
  });

  it("returns prediction ids in tool details for GUI state-change metadata", async () => {
    const result = await predictionsTool.execute("test", {
      action: "record",
      symbol: "AAPL",
      direction: "bullish",
      conviction: 8,
      entry_price: 180,
      timeframe_days: 30,
    });

    expect(result.details).toMatchObject({
      id: expect.any(Number),
      instrumentId: expect.any(Number),
      symbol: "AAPL",
      direction: "bullish",
    });
  });

  it("returns candidate matches for an unverified prediction symbol without recording", async () => {
    vi.mocked(getQuote).mockResolvedValue(quote("APL", 0, { volume: 0, week52High: 0, week52Low: 0 }));
    vi.mocked(httpGet).mockResolvedValue({
      quotes: [
        {
          symbol: "AAPL",
          longname: "Apple Inc.",
          quoteType: "EQUITY",
          exchange: "NMS",
          score: 101,
        },
      ],
    });

    const result = await predictionsTool.execute("test", {
      action: "record",
      symbol: "APL",
      direction: "bullish",
      conviction: 8,
      entry_price: 180,
      timeframe_days: 30,
    });

    expect(result.content[0].text).toContain("Could not verify APL");
    expect(result.details).toMatchObject({
      status: "needs_selection",
      query: "APL",
      candidates: [
        expect.objectContaining({ symbol: "AAPL", name: "Apple Inc." }),
      ],
    });

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    expect(service.listPredictions()).toHaveLength(0);
    db.close();
  });
});

describe("predictionsTool check", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T12:00:00.000Z"));
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-predictions-check-test-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
    vi.mocked(getQuote).mockResolvedValue(quote("AAPL", 200));
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalEnv == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalEnv;
    }
    rmSync(openCandleHome, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("persists resolved outcomes when checking expired predictions", async () => {
    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    service.recordPrediction({
      instrument: {
        symbol: "AAPL",
        assetType: "equity",
        name: "Apple Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
      direction: "bullish",
      conviction: 8,
      entryPrice: 180,
      timeframeDays: 30,
      now: new Date("2026-01-01T12:00:00.000Z"),
    });
    db.close();

    const result = await predictionsTool.execute("test", { action: "check" });

    expect(result.content[0].text).toContain("1 predictions (1 resolved, 0 open)");

    const verifyDb = initDefaultDatabase();
    const verifyService = new MarketStateService(verifyDb);
    const [prediction] = verifyService.listPredictions();
    verifyDb.close();

    expect(prediction.status).toBe("resolved");
    expect(prediction.resolvedAt).toBe("2026-03-01T12:00:00.000Z");
    expect(prediction.resultJson).toBe(JSON.stringify({
      currentPrice: 200,
      pnlPercent: 0.1111111111111111,
      correct: true,
    }));
  });

  it("cancels an open prediction without scoring it later", async () => {
    const recordResult = await predictionsTool.execute("test", {
      action: "record",
      symbol: "AAPL",
      direction: "bullish",
      conviction: 8,
      entry_price: 180,
      timeframe_days: 30,
    });
    const predictionId = (recordResult.details as { id: number }).id;

    const cancelResult = await predictionsTool.execute("test", {
      action: "cancel",
      id: predictionId,
    });

    expect(cancelResult.content[0].text).toContain(`Cancelled prediction #${predictionId}`);
    expect(cancelResult.details).toMatchObject({
      id: predictionId,
      status: "cancelled",
      resultJson: JSON.stringify({ reason: "user_cancelled" }),
    });

    const checkResult = await predictionsTool.execute("test", { action: "check" });
    expect(checkResult.content[0].text).toContain("No open predictions to check.");
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

function quote(symbol: string, price: number, overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    symbol,
    price,
    change: 0,
    changePercent: 0,
    open: price,
    high: price,
    low: price,
    previousClose: price,
    volume: 1_000,
    marketCap: 0,
    pe: null,
    week52High: price + 10,
    week52Low: price - 10,
    timestamp: Date.now(),
    ...overrides,
  };
}
