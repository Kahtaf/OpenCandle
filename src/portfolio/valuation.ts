import { normalizeCurrencyUnit } from "./currency-unit.js";
import { type FxResult, resolveFx } from "./fx.js";

export interface Money {
  amount: number;
  currency: string;
}
export interface ValuationLot {
  id: string;
  symbol: string;
  quantity: number;
  avgCost: number;
  costCurrency: string;
}
/** Acquisition owns security eligibility; keep its original observation time. */
export interface ValuationQuote {
  price: number;
  currency: string;
  observedAt: number | null;
  eligible: boolean;
  reason?: string | null;
}
export interface ValuationRow {
  lotId: string;
  fx: FxResult | null;
  nativeValue: Money | null;
  nativeCost: Money | null;
  nativePnl: Money | null;
  reportingValue: Money | null;
  reportingCost: Money | null;
  reportingPnl: Money | null;
  securityObservedAt: number | null;
  reason: string | null;
  allocationPercent: number | null;
  valuedAllocationPercent: number | null;
}
function money(amount: number, currency: string): Money | null {
  return Number.isFinite(amount) ? { amount, currency } : null;
}

/**
 * Pure arithmetic over eligible observations, without historical-cost inference.
 * Explicit stored GBP costs are major units; valuation never rewrites saved lots.
 */
export function valuePortfolio(input: {
  lots: readonly ValuationLot[];
  reportingCurrency: string;
  quotes: Readonly<Record<string, ValuationQuote | undefined>>;
  rates: readonly FxResult[];
  now: number;
}) {
  const base = input.reportingCurrency;
  const rows: ValuationRow[] = input.lots.map((lot) => {
    const quote = input.quotes[lot.symbol];
    const unit = normalizeCurrencyUnit(quote?.currency);
    const costUnit = normalizeCurrencyUnit(lot.costCurrency);
    const nativeCost =
      costUnit &&
      Number.isFinite(lot.avgCost) &&
      lot.avgCost >= 0 &&
      Number.isFinite(lot.quantity) &&
      lot.quantity >= 0
        ? money(lot.quantity * lot.avgCost * costUnit.scale, costUnit.currency)
        : null;
    const row: ValuationRow = {
      lotId: lot.id,
      fx: null,
      nativeValue: null,
      nativeCost,
      nativePnl: null,
      reportingValue: null,
      reportingCost: nativeCost?.currency === base ? nativeCost : null,
      reportingPnl: null,
      securityObservedAt: quote?.observedAt ?? null,
      reason: null,
      allocationPercent: null,
      valuedAllocationPercent: null,
    };
    if (!quote?.eligible || quote.observedAt === null || !Number.isFinite(quote.observedAt))
      row.reason = quote?.reason ?? "unavailable_quote";
    else if (!unit) row.reason = "missing_quote_currency";
    else if (
      !Number.isFinite(lot.quantity) ||
      lot.quantity < 0 ||
      !Number.isFinite(quote.price) ||
      quote.price < 0
    )
      row.reason = "invalid_value";
    else {
      row.nativeValue = money(lot.quantity * quote.price * unit.scale, unit.currency);
      if (row.nativeValue && nativeCost?.currency === unit.currency)
        row.nativePnl = money(row.nativeValue.amount - nativeCost.amount, unit.currency);
      const supplied = input.rates.find((r) => r.source === unit.currency && r.target === base);
      row.fx =
        unit.currency !== base && supplied?.status === "unavailable"
          ? supplied
          : resolveFx(
              unit.currency,
              base,
              supplied?.status === "ok" ? supplied.legs : null,
              input.now,
            );
      const rate = row.fx.status === "ok" ? row.fx.rate : undefined;
      if (!row.nativeValue) row.reason = "invalid_value";
      else if (rate === undefined)
        row.reason = row.fx.status === "unavailable" ? row.fx.reason : "missing_fx";
      else if (!Number.isFinite(rate) || rate <= 0) row.reason = "invalid_fx";
      else {
        row.reportingValue = money(row.nativeValue.amount * rate, base);
        if (!row.reportingValue) row.reason = "invalid_value";
        else if (row.reportingCost)
          row.reportingPnl = money(row.reportingValue.amount - row.reportingCost.amount, base);
      }
    }
    return row;
  });
  const included = rows.filter((row) => row.reportingValue !== null);
  let status: "empty" | "complete" | "partial" | "unavailable" =
    rows.length === 0
      ? "empty"
      : included.length === rows.length
        ? "complete"
        : included.length
          ? "partial"
          : "unavailable";
  const subtotal =
    included.length || rows.length === 0
      ? money(
          included.reduce((sum, row) => sum + (row.reportingValue?.amount ?? 0), 0),
          base,
        )
      : null;
  const aggregateReason = included.length > 0 && subtotal === null ? "invalid_aggregate" : null;
  if (aggregateReason) status = "unavailable";
  const totalValue = status === "empty" || status === "complete" ? subtotal : null;
  const accountingComplete =
    totalValue !== null &&
    rows.every((row) => row.reportingCost !== null && row.reportingPnl !== null);
  const totalCost = accountingComplete
    ? money(
        rows.reduce((sum, row) => sum + (row.reportingCost?.amount ?? 0), 0),
        base,
      )
    : null;
  const totalPnl =
    totalCost && totalValue ? money(totalValue.amount - totalCost.amount, base) : null;
  for (const row of included) {
    const percent =
      subtotal && subtotal.amount > 0 && row.reportingValue
        ? (row.reportingValue.amount / subtotal.amount) * 100
        : null;
    if (status === "complete") row.allocationPercent = percent;
    else row.valuedAllocationPercent = percent;
  }
  const buckets = new Map<string, number>();
  for (const row of rows)
    if (row.nativeCost)
      buckets.set(
        row.nativeCost.currency,
        (buckets.get(row.nativeCost.currency) ?? 0) + row.nativeCost.amount,
      );
  return {
    status,
    aggregateReason,
    rows,
    totalValue,
    valuedSubtotal: subtotal,
    totalCost,
    totalPnl,
    costSubtotals: [...buckets].map(([currency, amount]) => money(amount, currency)),
    includedLotIds: included.map((row) => row.lotId),
    excludedLotIds: rows.filter((row) => !row.reportingValue).map((row) => row.lotId),
  };
}
