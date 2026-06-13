const COMMON_FUND_OR_INDEX_SYMBOLS = new Set([
  "AGG",
  "ARKK",
  "BND",
  "DIA",
  "DGRO",
  "GLD",
  "HYG",
  "IEF",
  "IVV",
  "IWD",
  "IWF",
  "IWM",
  "JEPI",
  "JEPQ",
  "LQD",
  "NOBL",
  "QQQ",
  "QQQM",
  "SCHD",
  "SHY",
  "SLV",
  "SMH",
  "SOXX",
  "SPY",
  "TLT",
  "VEA",
  "VIG",
  "VNQ",
  "VOO",
  "VTI",
  "VTV",
  "VUG",
  "VWO",
  "VYM",
  "VXUS",
  "XLB",
  "XLE",
  "XLF",
  "XLI",
  "XLK",
  "XLP",
  "XLRE",
  "XLU",
  "XLV",
  "XLY",
]);

export function areLikelyFundOrIndexSymbols(symbols: string[]): boolean {
  return (
    symbols.length > 0 &&
    symbols.every((symbol) => COMMON_FUND_OR_INDEX_SYMBOLS.has(symbol.toUpperCase()))
  );
}

export function isFundOrIndexAssetScope(assetScope: string | undefined): boolean {
  return assetScope !== undefined && /(?:^|[^a-z])(?:etf|fund|index)(?:$|[^a-z])/i.test(assetScope);
}
