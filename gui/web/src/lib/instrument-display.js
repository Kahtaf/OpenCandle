const MARKET_DISPLAY_NAMES = new Map([
  ["^GSPC", "S&P 500"],
  ["^NDX", "Nasdaq 100"],
  ["^DJI", "Dow Jones"],
  ["BTC-USD", "Bitcoin"],
]);

export function instrumentDisplayName(symbol, fallbackName) {
  return MARKET_DISPLAY_NAMES.get(String(symbol ?? "").toUpperCase()) || fallbackName || symbol;
}
