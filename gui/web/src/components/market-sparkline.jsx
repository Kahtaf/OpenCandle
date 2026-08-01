import { useState } from "react";
import { tickerLineProxySparklineUrl } from "../../../shared/ticker-line.ts";

export function MarketSparkline({ symbol, assetType, className = "" }) {
  const sparklineUrl = tickerLineProxySparklineUrl(symbol, assetType);

  if (!sparklineUrl) {
    return <UnavailableSparkline className={className} kind="unsupported" />;
  }

  return (
    <TickerLineSparkline
      key={sparklineUrl}
      symbol={symbol}
      sparklineUrl={sparklineUrl}
      className={className}
    />
  );
}

function TickerLineSparkline({ symbol, sparklineUrl, className }) {
  const [failureCount, setFailureCount] = useState(0);
  if (failureCount > 1) {
    return <UnavailableSparkline className={className} kind="provider" />;
  }

  const imageUrl = failureCount === 0 ? sparklineUrl : `${sparklineUrl}&retry=${failureCount}`;
  return (
    <figure
      data-slot="market-sparkline"
      data-source="Ticker Line"
      className={`w-24 sm:w-[120px] ${className}`.trim()}
    >
      <img
        src={imageUrl}
        alt={`${symbol} 24-hour price sparkline from Ticker Line`}
        width="120"
        height="30"
        loading="lazy"
        decoding="async"
        onError={() => setFailureCount((count) => count + 1)}
        className="block h-[29px] w-24 object-contain sm:h-9 sm:w-[120px]"
      />
      <figcaption className="truncate text-[10px] leading-4 tabular-nums text-muted-foreground">
        Ticker Line · 1D
      </figcaption>
    </figure>
  );
}

function UnavailableSparkline({ className, kind }) {
  const providerFailure = kind === "provider";
  return (
    <figure
      data-slot="market-sparkline"
      data-source="Ticker Line"
      className={`w-24 sm:w-[120px] ${className}`.trim()}
      title={
        providerFailure
          ? "Ticker Line is temporarily unavailable"
          : "Ticker Line does not support this instrument"
      }
    >
      <div className="flex h-[29px] items-center text-[10px] text-muted-foreground sm:h-9">
        Unavailable
      </div>
      <figcaption className="truncate text-[10px] leading-4 tabular-nums text-muted-foreground">
        Ticker Line · {providerFailure ? "provider unavailable" : "unavailable"}
      </figcaption>
    </figure>
  );
}
