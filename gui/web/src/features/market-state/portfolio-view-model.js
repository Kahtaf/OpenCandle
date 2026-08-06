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
    if (!Number.isFinite(lot?.marketValue) || !Number.isFinite(lot?.changePercent)) continue;
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
  const quotesByLotId = new Map(portfolioQuotes.map((quote) => [quote.lotId, quote]));
  const rowsBySymbol = new Map();

  for (const lot of lots) {
    const quote = quotesByLotId.get(lot.id) ?? null;
    let row = rowsBySymbol.get(lot.symbol);
    if (!row) {
      row = {
        symbol: lot.symbol,
        assetType: lot.assetType ?? quote?.assetType ?? "unknown",
        name: lot.name ?? null,
        instrumentId: lot.instrumentId,
        currency: lot.currency,
        totalQuantity: 0,
        totalCost: 0,
        marketValue: null,
        currentPrice: null,
        pnl: null,
        pnlPercent: null,
        changePercent: null,
        allocationPercent: null,
        fetchedAt: null,
        marketState: null,
        extendedPrice: null,
        extendedChange: null,
        extendedChangePercent: null,
        extendedAsOf: null,
        excludedLotCount: 0,
        excludedFromTotals: false,
        exclusionReason: null,
        nativeMarketValue: null,
        nativePnl: null,
        lots: [],
      };
      rowsBySymbol.set(lot.symbol, row);
    }

    row.totalQuantity += lot.quantity;
    row.lots.push({ ...lot, quote });
    row.name = quote?.name ?? row.name;
    row.assetType = quote?.assetType ?? row.assetType;

    if (quote?.status === "ok") {
      // A quote priced in the lot's own currency is real data even when the
      // portfolio cannot convert it into its base currency. The price, the day
      // change and the value stay on the row in that currency; only the base
      // currency totals and the allocation share leave it out.
      //
      // Grouping by symbol cannot mix currencies here: the snapshot builder only
      // reports `ok` when the quote currency equals the lot currency, so every
      // `ok` lot of one symbol shares that currency and the same
      // `includedInTotals` verdict. A lot in any other currency arrives as
      // `unavailable` and takes the branch below.
      row.totalCost += quote.totalCost;
      row.currentPrice = quote.currentPrice ?? row.currentPrice;
      row.changePercent = quote.changePercent ?? row.changePercent;
      row.fetchedAt = quote.fetchedAt ?? row.fetchedAt;
      row.marketState = quote.marketState ?? row.marketState;
      row.extendedPrice = quote.extendedPrice ?? row.extendedPrice;
      row.extendedChange = quote.extendedChange ?? row.extendedChange;
      row.extendedChangePercent = quote.extendedChangePercent ?? row.extendedChangePercent;
      row.extendedAsOf = quote.extendedAsOf ?? row.extendedAsOf;
      if (quote.includedInTotals) {
        row.marketValue = (row.marketValue ?? 0) + (quote.marketValue ?? 0);
        row.pnl = (row.pnl ?? 0) + (quote.pnl ?? 0);
        row.allocationPercent = (row.allocationPercent ?? 0) + (quote.allocationPercent ?? 0);
      } else {
        row.nativeMarketValue = (row.nativeMarketValue ?? 0) + (quote.marketValue ?? 0);
        row.nativePnl = (row.nativePnl ?? 0) + (quote.pnl ?? 0);
        row.exclusionReason = row.exclusionReason ?? quote.reason ?? null;
        row.excludedLotCount += 1;
      }
    } else {
      // No usable quote: still count cost from lot fields so blended cost stays meaningful.
      row.totalCost += lot.avgCost * lot.quantity;
      if (quote != null) row.excludedLotCount += 1;
    }
  }

  const rows = [...rowsBySymbol.values()].map((row) => {
    // A row whose only value is unconvertible shows that value in its own
    // currency and says so. A row with any base-currency value keeps the base
    // currency figures, so the two are never added together.
    const nativeOnly = row.marketValue == null && row.nativeMarketValue != null;
    const marketValue = nativeOnly ? row.nativeMarketValue : row.marketValue;
    const pnl = nativeOnly ? row.nativePnl : row.pnl;
    return {
      ...row,
      marketValue,
      pnl,
      excludedFromTotals: nativeOnly,
      exclusionReason: nativeOnly ? row.exclusionReason : null,
      blendedCost: row.totalQuantity > 0 ? row.totalCost / row.totalQuantity : null,
      pnlPercent:
        pnl != null && marketValue != null && marketValue - pnl > 0
          ? (pnl / (marketValue - pnl)) * 100
          : null,
      // Today's move in currency, so the holdings table can pair the day percent
      // with the dollars it actually moved.
      dayMove: derivePortfolioDayMove([{ marketValue, changePercent: row.changePercent }]),
    };
  });

  // Values in another currency are not comparable with the base-currency ones,
  // so they rank among themselves below the holdings the totals are built from.
  return rows.sort(
    (a, b) =>
      Number(a.excludedFromTotals) - Number(b.excludedFromTotals) ||
      (b.marketValue ?? -1) - (a.marketValue ?? -1),
  );
}
