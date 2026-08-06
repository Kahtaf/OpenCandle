import { describe, expect, it } from "vitest";
import {
  buildHoldingRows,
  derivePortfolioDayMove,
  topAllocationSegments,
} from "../../../gui/web/src/features/market-state/portfolio-view-model.js";

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

  it("carries a per-row day move so the holdings table can show today in currency", () => {
    const quotes = QUOTES.map((quote) => ({
      ...quote,
      changePercent: quote.symbol === "AAPL" ? 2 : -1.5,
    }));
    const rows = buildHoldingRows(LOTS, quotes);

    const aapl = rows.find((row) => row.symbol === "AAPL");
    expect(aapl.dayMove).toBeCloseTo(21859.5 - 21859.5 / 1.02, 2);
    const nvda = rows.find((row) => row.symbol === "NVDA");
    expect(nvda.dayMove).toBeCloseTo(16340 - 16340 / 0.985, 2);
  });

  it("leaves the day move null when the row has no usable change percent", () => {
    const rows = buildHoldingRows(LOTS, []);
    expect(rows.every((row) => row.dayMove === null)).toBe(true);
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

  it("keeps a priced foreign-currency holding readable in its own currency", () => {
    const lots = [
      {
        id: 9,
        instrumentId: 21,
        symbol: "SAP.DE",
        instrumentName: "SAP SE",
        quantity: 10,
        avgCost: 150,
        currency: "EUR",
        openedAt: "2025-04-02T09:00:00Z",
      },
    ];
    const quotes = [
      {
        lotId: 9,
        symbol: "SAP.DE",
        status: "ok",
        currentPrice: 168.64,
        changePercent: 0.75,
        marketValue: 1686.4,
        totalCost: 1500,
        pnl: 186.4,
        currency: "EUR",
        includedInTotals: false,
        reason: "No FX conversion from EUR to USD",
        fetchedAt: "2026-06-12T14:58:00Z",
      },
    ];

    const [row] = buildHoldingRows(lots, quotes);
    expect(row.currentPrice).toBeCloseTo(168.64, 2);
    expect(row.changePercent).toBeCloseTo(0.75, 2);
    expect(row.marketValue).toBeCloseTo(1686.4, 2);
    expect(row.pnl).toBeCloseTo(186.4, 2);
    expect(row.dayMove).toBeCloseTo(1686.4 - 1686.4 / 1.0075, 2);
    expect(row.fetchedAt).toBe("2026-06-12T14:58:00Z");
    // The value is real but it is not the portfolio's base currency, so it is
    // flagged rather than folded into totals or allocation.
    expect(row.excludedFromTotals).toBe(true);
    expect(row.exclusionReason).toBe("No FX conversion from EUR to USD");
    expect(row.allocationPercent).toBeNull();
  });

  it("keeps base-currency totals free of foreign-currency holdings", () => {
    const lots = [
      ...LOTS,
      {
        id: 9,
        instrumentId: 21,
        symbol: "SAP.DE",
        quantity: 10,
        avgCost: 150,
        currency: "EUR",
        openedAt: "2025-04-02T09:00:00Z",
      },
    ];
    const quotes = [
      ...QUOTES.map((quote) => ({ ...quote, changePercent: 1 })),
      {
        lotId: 9,
        symbol: "SAP.DE",
        status: "ok",
        currentPrice: 168.64,
        changePercent: 0.75,
        marketValue: 1686.4,
        totalCost: 1500,
        pnl: 186.4,
        currency: "EUR",
        includedInTotals: false,
        reason: "No FX conversion from EUR to USD",
      },
    ];

    const rows = buildHoldingRows(lots, quotes);
    const included = rows.filter((row) => !row.excludedFromTotals);
    expect(included.map((row) => row.symbol).sort()).toEqual(["AAPL", "NVDA"]);
    expect(derivePortfolioDayMove(included)).toBeCloseTo(
      21859.5 - 21859.5 / 1.01 + (16340 - 16340 / 1.01),
      2,
    );
  });

  it("keeps an unknown quote currency explicit instead of borrowing a price", () => {
    const quotes = [
      {
        lotId: 3,
        symbol: "NVDA",
        status: "unavailable",
        currentPrice: null,
        marketValue: null,
        pnl: null,
        totalCost: 9424,
        currency: "USD",
        includedInTotals: false,
        reason: "Quote currency unavailable",
      },
    ];

    const rows = buildHoldingRows(LOTS, quotes);
    const nvda = rows.find((row) => row.symbol === "NVDA");
    expect(nvda.currentPrice).toBeNull();
    expect(nvda.marketValue).toBeNull();
    expect(nvda.pnl).toBeNull();
    expect(nvda.excludedFromTotals).toBe(false);
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

describe("topAllocationSegments", () => {
  const rows = [
    { symbol: "AAPL", allocationPercent: 30, marketValue: 3000 },
    { symbol: "NVDA", allocationPercent: 25, marketValue: 2500 },
    { symbol: "MSFT", allocationPercent: 15, marketValue: 1500 },
    { symbol: "COST", allocationPercent: 10, marketValue: 1000 },
    { symbol: "ASTS", allocationPercent: 8, marketValue: 800 },
    { symbol: "AMD", allocationPercent: 7, marketValue: 700 },
    { symbol: "SHOP", allocationPercent: 5, marketValue: 500 },
  ];

  it("keeps every segment when the holding count fits the colour palette", () => {
    expect(topAllocationSegments(rows.slice(0, 4))).toEqual([
      { symbol: "AAPL", percent: 30, value: 3000 },
      { symbol: "NVDA", percent: 25, value: 2500 },
      { symbol: "MSFT", percent: 15, value: 1500 },
      { symbol: "COST", percent: 10, value: 1000 },
    ]);
  });

  it("rolls the smallest holdings into one exact remainder segment", () => {
    const segments = topAllocationSegments(rows);

    expect(segments).toHaveLength(6);
    expect(segments.slice(0, 5).map((segment) => segment.symbol)).toEqual([
      "AAPL",
      "NVDA",
      "MSFT",
      "COST",
      "ASTS",
    ]);
    expect(segments[5]).toEqual({ symbol: "Other", percent: 12, value: 1200 });
  });

  it("drops holdings with no usable allocation", () => {
    expect(
      topAllocationSegments([
        { symbol: "AAPL", allocationPercent: 100, marketValue: 100 },
        { symbol: "SHOP.TO", allocationPercent: null, marketValue: null },
        { symbol: "CASH", allocationPercent: 0, marketValue: 0 },
      ]),
    ).toEqual([{ symbol: "AAPL", percent: 100, value: 100 }]);
  });
});

describe("derivePortfolioDayMove", () => {
  it("sums only lots with finite market values and change percentages", () => {
    const lots = [
      { marketValue: 1010, changePercent: 1 },
      { marketValue: 1960, changePercent: -2 },
      { marketValue: 500, changePercent: null },
      { marketValue: null, changePercent: 4 },
      { marketValue: Number.POSITIVE_INFINITY, changePercent: 3 },
      { marketValue: 200, changePercent: Number.NaN },
    ];

    expect(derivePortfolioDayMove(lots)).toBeCloseTo(1010 - 1010 / 1.01 + (1960 - 1960 / 0.98));
  });

  it("returns null when no lot has usable day-move data", () => {
    expect(
      derivePortfolioDayMove([
        { marketValue: null, changePercent: 1 },
        { marketValue: 100, changePercent: undefined },
      ]),
    ).toBeNull();
  });
});
