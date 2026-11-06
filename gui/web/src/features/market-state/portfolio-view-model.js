// The allocation donut cycles a six-colour palette, so anything past the fifth
// holding would repeat a colour and stretch the legend past the stat header it
// sits beside. The tail collapses into one exact remainder segment instead.
const ALLOCATION_SEGMENT_LIMIT = 6;

export function topAllocationSegments(rows = []) {
  const segments = rows
    .filter((row) => Number.isFinite(row?.allocationPercent) && row.allocationPercent > 0)
    .map((row) => ({
      symbol: row.symbol,
      percent: row.allocationPercent,
      value: Number.isFinite(row.marketValue) ? row.marketValue : null,
    }))
    .sort((a, b) => b.percent - a.percent);

  if (segments.length <= ALLOCATION_SEGMENT_LIMIT) return segments;

  const kept = segments.slice(0, ALLOCATION_SEGMENT_LIMIT - 1);
  const tail = segments.slice(ALLOCATION_SEGMENT_LIMIT - 1);
  const percent = tail.reduce((sum, segment) => sum + segment.percent, 0);
  const values = tail.map((segment) => segment.value);
  const value = values.every((entry) => Number.isFinite(entry))
    ? values.reduce((sum, entry) => sum + entry, 0)
    : null;
  return [...kept, { symbol: "Other", percent, value }];
}

export function derivePortfolioDayMove(lots = []) {
  let total = 0;
  let qualifyingLots = 0;
  for (const lot of lots) {
    // Current FX cannot establish a reporting-currency daily return.
    if (
      lot?.excludedFromTotals ||
      (lot?.fx?.status === "ok" && lot.fx.method !== "identity") ||
      (lot?.quoteCurrency &&
        (lot.reportingCurrency ?? lot.currency) &&
        lot.quoteCurrency !== (lot.reportingCurrency ?? lot.currency))
    )
      return null;
    if (!Number.isFinite(lot?.marketValue) || !Number.isFinite(lot?.changePercent)) return null;
    const denominator = 1 + lot.changePercent / 100;
    if (!Number.isFinite(denominator) || denominator <= 0) continue;
    const move = lot.marketValue - lot.marketValue / denominator;
    if (!Number.isFinite(move)) continue;
    total += move;
    if (!Number.isFinite(total)) return null;
    qualifyingLots += 1;
  }
  return qualifyingLots > 0 ? total : null;
}

export function buildHoldingRows(lots = [], portfolioQuotes = []) {
  const quotesById = new Map(portfolioQuotes.map((q) => [q.lotId, q]));
  const groups = new Map();
  for (const lot of lots) {
    const key = lot.symbol;
    const group = groups.get(key) ?? [];
    group.push({ ...lot, quote: quotesById.get(lot.id) ?? null });
    groups.set(key, group);
  }
  const sum = (items, get) =>
    items.every((item) => Number.isFinite(get(item)))
      ? items.reduce((total, item) => total + get(item), 0)
      : null;
  return [...groups.entries()]
    .map(([, entries]) => {
      const symbol = entries[0].symbol;
      const first = entries[0];
      const quote = entries.find((l) => l.quote?.status === "ok")?.quote;
      const sameCostCurrency = entries.every((l) => l.currency === first.currency);
      const totalQuantity = entries.reduce((sum, l) => sum + l.quantity, 0);
      const cost = sameCostCurrency ? sum(entries, (l) => l.avgCost * l.quantity) : null;
      const sameReportingCurrency = entries.every(
        (l) => l.quote?.reportingCurrency === quote?.reportingCurrency,
      );
      const marketValue = sameReportingCurrency ? sum(entries, (l) => l.quote?.marketValue) : null;
      const pnl = sameReportingCurrency ? sum(entries, (l) => l.quote?.pnl) : null;
      const reportingCost = sum(entries, (l) => l.quote?.totalCost);
      const excludedLotCount = entries.filter((l) => !l.quote?.includedInTotals).length;
      const nativeValue = sum(entries, (l) => l.quote?.nativeValue?.amount);
      const nativeOnly = marketValue === null && nativeValue !== null;
      const changePercent = quote?.changePercent ?? null;
      return {
        symbol,
        name: quote?.name ?? first.name,
        assetType: first.assetType,
        instrumentId: first.instrumentId,
        currency: nativeOnly ? quote?.quoteCurrency : (quote?.reportingCurrency ?? first.currency),
        quoteCurrency: quote?.quoteCurrency ?? first.currency,
        costCurrency: sameCostCurrency ? first.currency : null,
        totalQuantity,
        totalCost: cost,
        blendedCost: cost !== null && totalQuantity > 0 ? cost / totalQuantity : null,
        currentPrice: quote?.currentPrice ?? null,
        marketValue: nativeOnly ? nativeValue : marketValue,
        pnl: nativeOnly ? sum(entries, (l) => l.quote?.nativePnl?.amount) : pnl,
        pnlPercent: pnl !== null && reportingCost > 0 ? (pnl / reportingCost) * 100 : null,
        changePercent,
        dayMove: sameReportingCurrency ? derivePortfolioDayMove(entries.map((l) => l.quote)) : null,
        allocationPercent: sum(entries, (l) => l.quote?.allocationPercent),
        valuedAllocationPercent: sum(entries, (l) => l.quote?.valuedAllocationPercent),
        fetchedAt: quote?.fetchedAt,
        dataAsOf: quote?.dataAsOf,
        marketState: quote?.marketState,
        extendedPrice: quote?.extendedPrice,
        extendedChange: quote?.extendedChange,
        extendedChangePercent: quote?.extendedChangePercent,
        extendedAsOf: quote?.extendedAsOf,
        excludedLotCount,
        excludedFromTotals: excludedLotCount > 0,
        exclusionReason: entries.find((l) => l.quote?.reason)?.quote.reason,
        nativeMarketValue: nativeValue,
        lots: entries,
      };
    })
    .sort(
      (a, b) =>
        Number(a.excludedFromTotals) - Number(b.excludedFromTotals) ||
        (b.marketValue ?? -1) - (a.marketValue ?? -1),
    );
}
