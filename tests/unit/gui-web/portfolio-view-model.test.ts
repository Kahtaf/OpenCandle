import { describe, expect, it } from "vitest";
import { buildHoldingRows } from "../../../gui/web/src/features/market-state/portfolio-view-model.js";

const LOTS = [
  {
    id: 1,
    instrumentId: 10,
    symbol: "AAPL",
    instrumentName: "Apple Inc.",
    quantity: 50,
    avgCost: 168.4,
    currency: "USD",
    openedAt: "2024-11-12T14:30:00Z",
  },
  {
    id: 2,
    instrumentId: 10,
    symbol: "AAPL",
    instrumentName: "Apple Inc.",
    quantity: 25,
    avgCost: 231.1,
    currency: "USD",
    openedAt: "2025-09-03T14:30:00Z",
  },
  {
    id: 3,
    instrumentId: 11,
    symbol: "NVDA",
    instrumentName: "NVIDIA Corporation",
    quantity: 80,
    avgCost: 117.8,
    currency: "USD",
    openedAt: "2025-02-20T14:30:00Z",
  },
];

const QUOTES = [
  {
    lotId: 1,
    symbol: "AAPL",
    status: "ok",
    currentPrice: 291.46,
    marketValue: 14573,
    totalCost: 8420,
    pnl: 6153,
    pnlPercent: 73.08,
    allocationPercent: 30,
    currency: "USD",
    includedInTotals: true,
    fetchedAt: "2026-06-12T14:58:00Z",
  },
  {
    lotId: 2,
    symbol: "AAPL",
    status: "ok",
    currentPrice: 291.46,
    marketValue: 7286.5,
    totalCost: 5777.5,
    pnl: 1509,
    pnlPercent: 26.12,
    allocationPercent: 15,
    currency: "USD",
    includedInTotals: true,
    fetchedAt: "2026-06-12T14:58:00Z",
  },
  {
    lotId: 3,
    symbol: "NVDA",
    status: "ok",
    currentPrice: 204.25,
    marketValue: 16340,
    totalCost: 9424,
    pnl: 6916,
    pnlPercent: 73.39,
    allocationPercent: 55,
    currency: "USD",
    includedInTotals: true,
    fetchedAt: "2026-06-12T14:58:00Z",
  },
];

describe("buildHoldingRows", () => {
  it("rolls up lots into one row per symbol with blended cost and combined P&L", () => {
    const rows = buildHoldingRows(LOTS, QUOTES);

    expect(rows).toHaveLength(2);
    const aapl = rows.find((row) => row.symbol === "AAPL");
    expect(aapl.totalQuantity).toBe(75);
    expect(aapl.blendedCost).toBeCloseTo((8420 + 5777.5) / 75, 2);
    expect(aapl.marketValue).toBeCloseTo(21859.5, 2);
    expect(aapl.pnl).toBeCloseTo(7662, 2);
    expect(aapl.allocationPercent).toBeCloseTo(45, 2);
    expect(aapl.lots).toHaveLength(2);
    expect(aapl.lots[0].id).toBe(1);
  });

  it("sorts rows by market value descending", () => {
    const rows = buildHoldingRows(LOTS, QUOTES);
    expect(rows.map((row) => row.symbol)).toEqual(["AAPL", "NVDA"]);
  });

  it("keeps rows without quotes, leaving value fields null", () => {
    const rows = buildHoldingRows(LOTS, []);
    const aapl = rows.find((row) => row.symbol === "AAPL");
    expect(aapl.marketValue).toBeNull();
    expect(aapl.pnl).toBeNull();
    expect(aapl.totalQuantity).toBe(75);
  });

  it("excludes currency-mismatched lots from rollup math but keeps them listed", () => {
    const quotes = [
      { ...QUOTES[0] },
      {
        lotId: 2,
        symbol: "AAPL",
        status: "unavailable",
        totalCost: 5777.5,
        currency: "CAD",
        includedInTotals: false,
        reason: "No FX conversion from CAD to USD",
      },
      { ...QUOTES[2] },
    ];
    const rows = buildHoldingRows(LOTS, quotes);
    const aapl = rows.find((row) => row.symbol === "AAPL");
    expect(aapl.marketValue).toBeCloseTo(14573, 2);
    expect(aapl.excludedLotCount).toBe(1);
    expect(aapl.lots).toHaveLength(2);
  });
});
