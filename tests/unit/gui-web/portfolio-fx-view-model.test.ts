import { expect, it } from "vitest";
// @ts-expect-error Browser JavaScript module.
import {
  buildHoldingRows,
  derivePortfolioDayMove,
} from "../../../gui/web/src/features/market-state/portfolio-view-model.js";

it("mixed acquisition currencies never blend costs or fill unknown reporting P&L with zero", () => {
  const lots = [
    { id: 1, symbol: "SAP", currency: "USD", quantity: 1, avgCost: 8 },
    { id: 2, symbol: "SAP", currency: "EUR", quantity: 1, avgCost: 8 },
  ];
  const rows = buildHoldingRows(
    lots,
    lots.map((lot) => ({
      lotId: lot.id,
      status: "ok",
      currency: lot.currency,
      reportingCurrency: "USD",
      quoteCurrency: "EUR",
      currentPrice: 10,
      marketValue: 12,
      pnl: lot.id === 1 ? 4 : null,
      totalCost: lot.id === 1 ? 8 : null,
      includedInTotals: true,
    })),
  );
  expect(rows[0].blendedCost).toBeNull();
  expect(rows[0].pnl).toBeNull();
  expect(rows[0].marketValue).toBe(24);
  expect(rows[0].dayMove).toBeNull();
});
it("a portfolio daily move needs every holding and historical FX", () => {
  expect(
    derivePortfolioDayMove([
      { marketValue: 20, changePercent: 10 },
      { marketValue: 20, changePercent: null },
    ]),
  ).toBeNull();
});
