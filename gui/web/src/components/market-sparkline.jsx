import { useState } from "react";
import { tickerLineProxySparklineUrl } from "../../../shared/ticker-line.ts";

export function MarketSparkline({ symbol, assetType, className = "" }) {
  const sparklineUrl = tickerLineProxySparklineUrl(symbol, assetType);
  const [failedUrl, setFailedUrl] = useState(null);

  if (!sparklineUrl || failedUrl === sparklineUrl) {
    return (
      <figure
        data-slot="market-sparkline"
        data-source="Ticker Line"
        className={`w-24 sm:w-[120px] ${className}`.trim()}
        title="Ticker Line does not support this instrument"
      >
        <div className="flex h-[29px] items-center text-[10px] text-muted-foreground sm:h-9">
          Unavailable
        </div>
        <figcaption className="truncate text-[10px] leading-4 tabular-nums text-muted-foreground">
          Ticker Line · unavailable
        </figcaption>
      </figure>
    );
  }

  return (
    <figure
      data-slot="market-sparkline"
      data-source="Ticker Line"
      className={`w-24 sm:w-[120px] ${className}`.trim()}
    >
      <img
        src={sparklineUrl}
        alt={`${symbol} 24-hour price sparkline from Ticker Line`}
        width="120"
        height="30"
        loading="lazy"
        decoding="async"
        onError={() => setFailedUrl(sparklineUrl)}
        className="block h-[29px] w-24 object-contain sm:h-9 sm:w-[120px]"
      />
      <figcaption className="truncate text-[10px] leading-4 tabular-nums text-muted-foreground">
        Ticker Line · 1D
      </figcaption>
    </figure>
  );
}
