export function buildHoldingRows(lots = [], portfolioQuotes = []) {
  const quotesByLotId = new Map(portfolioQuotes.map((quote) => [quote.lotId, quote]));
  const rowsBySymbol = new Map();

  for (const lot of lots) {
    const quote = quotesByLotId.get(lot.id) ?? null;
    let row = rowsBySymbol.get(lot.symbol);
    if (!row) {
      row = {
        symbol: lot.symbol,
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
        sparkline: null,
        excludedLotCount: 0,
        lots: [],
      };
      rowsBySymbol.set(lot.symbol, row);
    }

    row.totalQuantity += lot.quantity;
    row.lots.push({ ...lot, quote });
    row.name = quote?.name ?? row.name;
    row.sparkline = row.sparkline ?? quote?.sparkline ?? null;

    if (quote?.status === "ok" && quote.includedInTotals) {
      row.totalCost += quote.totalCost;
      row.marketValue = (row.marketValue ?? 0) + (quote.marketValue ?? 0);
      row.pnl = (row.pnl ?? 0) + (quote.pnl ?? 0);
      row.allocationPercent = (row.allocationPercent ?? 0) + (quote.allocationPercent ?? 0);
      row.currentPrice = quote.currentPrice ?? row.currentPrice;
      row.changePercent = quote.changePercent ?? row.changePercent;
      row.fetchedAt = quote.fetchedAt ?? row.fetchedAt;
      row.marketState = quote.marketState ?? row.marketState;
      row.extendedPrice = quote.extendedPrice ?? row.extendedPrice;
      row.extendedChange = quote.extendedChange ?? row.extendedChange;
      row.extendedChangePercent = quote.extendedChangePercent ?? row.extendedChangePercent;
      row.extendedAsOf = quote.extendedAsOf ?? row.extendedAsOf;
    } else {
      // No usable quote: still count cost from lot fields so blended cost stays meaningful.
      row.totalCost += lot.avgCost * lot.quantity;
      if (quote != null) row.excludedLotCount += 1;
    }
  }

  const rows = [...rowsBySymbol.values()].map((row) => ({
    ...row,
    blendedCost: row.totalQuantity > 0 ? row.totalCost / row.totalQuantity : null,
    pnlPercent:
      row.pnl != null && row.marketValue != null && row.marketValue - row.pnl > 0
        ? (row.pnl / (row.marketValue - row.pnl)) * 100
        : null,
  }));

  return rows.sort((a, b) => (b.marketValue ?? -1) - (a.marketValue ?? -1));
}
