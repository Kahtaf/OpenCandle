const MARKET_DISPLAY_NAMES = new Map([
  ["^GSPC", "S&P 500"],
  ["^IXIC", "Nasdaq Composite"],
  ["^DJI", "Dow Jones"],
  ["BTC-USD", "Bitcoin"],
]);

export function instrumentDisplayName(symbol, fallbackName) {
  return MARKET_DISPLAY_NAMES.get(String(symbol ?? "").toUpperCase()) || fallbackName || symbol;
}
