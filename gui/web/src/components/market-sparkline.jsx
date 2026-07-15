const TICKER_LINE_ENDPOINT = "https://ticker-line.com/v1/sparkline";

export function marketSparklineUrl(symbol) {
  const ticker = String(symbol ?? "").trim();
  const params = new URLSearchParams({
    ticker,
    timeframe: "1d",
    theme: "light",
    fill: "true",
  });
  return `${TICKER_LINE_ENDPOINT}?${params.toString()}`;
}

export function MarketSparkline({ symbol, className = "" }) {
  return (
    <img
      data-slot="market-sparkline"
      src={marketSparklineUrl(symbol)}
      alt={`${symbol} 24-hour price sparkline`}
      width="160"
      height="48"
      loading="lazy"
      decoding="async"
      className={`block h-[29px] w-24 max-w-none object-contain sm:h-9 sm:w-[120px] ${className}`.trim()}
    />
  );
}
