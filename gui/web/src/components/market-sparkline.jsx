import { useEffect, useRef, useState } from "react";
import { tickerLineProxySparklineUrl } from "../../../shared/ticker-line.ts";

const SPARKLINE_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const SPARKLINE_REFRESH_INTERVAL_MS = 5 * 60_000;

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
  const [metadata, setMetadata] = useState({ status: "loading" });
  const [isIntersecting, setIsIntersecting] = useState(false);
  const sparklineRef = useRef(null);
  const supportsVisibilityTracking = typeof IntersectionObserver !== "undefined";
  const isVisible = !supportsVisibilityTracking || isIntersecting;

  useEffect(() => {
    if (!supportsVisibilityTracking) return undefined;
    const observer = new IntersectionObserver(
      (entries) => setIsIntersecting(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "200px 0px" },
    );
    if (sparklineRef.current) observer.observe(sparklineRef.current);
    return () => observer.disconnect();
  }, [supportsVisibilityTracking]);

  useEffect(() => {
    if (!isVisible) return undefined;
    const controller = new AbortController();
    let refreshTimer;
    const refreshMetadata = async () => {
      try {
        const dataAsOf = await fetchSparklineMetadata(sparklineUrl, controller.signal);
        if (!controller.signal.aborted) {
          setFailureCount(0);
          setMetadata({ status: "ok", dataAsOf });
        }
      } catch (error) {
        if (error?.name !== "AbortError") setMetadata({ status: "failed" });
      } finally {
        if (!controller.signal.aborted) {
          refreshTimer = window.setTimeout(refreshMetadata, SPARKLINE_REFRESH_INTERVAL_MS);
        }
      }
    };
    void refreshMetadata();
    return () => {
      window.clearTimeout(refreshTimer);
      controller.abort();
    };
  }, [isVisible, sparklineUrl]);

  let content;
  if (metadata.status === "loading") {
    content = <PendingSparkline contained />;
  } else if (metadata.status === "failed" || failureCount > 1) {
    content = <UnavailableSparkline contained kind="provider" />;
  } else {
    const versionedImageUrl = `${sparklineUrl}&asOf=${encodeURIComponent(metadata.dataAsOf)}`;
    const imageUrl =
      failureCount === 0 ? versionedImageUrl : `${versionedImageUrl}&retry=${failureCount}`;
    const asOf = formatSparklineAsOf(metadata.dataAsOf);
    content = (
      <figure data-slot="market-sparkline" data-source="Ticker Line" className="w-full">
        <img
          src={imageUrl}
          alt={`${symbol} 1-day price sparkline from Ticker Line, data as of ${asOf}`}
          width="120"
          height="30"
          loading="lazy"
          decoding="async"
          onError={() => setFailureCount((count) => count + 1)}
          className="block h-[29px] w-24 object-contain sm:h-9 sm:w-[120px]"
        />
        <figcaption className="truncate text-[10px] leading-4 tabular-nums text-muted-foreground">
          Ticker Line · {asOf}
        </figcaption>
      </figure>
    );
  }
  return (
    <div
      ref={sparklineRef}
      data-slot="market-sparkline-visibility"
      className={`w-24 sm:w-[120px] ${className}`.trim()}
    >
      {content}
    </div>
  );
}

function PendingSparkline({ className = "", contained = false }) {
  return (
    <figure
      data-slot="market-sparkline"
      data-source="Ticker Line"
      className={`${contained ? "w-full" : "w-24 sm:w-[120px]"} ${className}`.trim()}
      title="Loading Ticker Line sparkline"
    >
      <div className="flex h-[29px] items-center text-[10px] text-muted-foreground sm:h-9">
        Loading…
      </div>
      <figcaption className="truncate text-[10px] leading-4 tabular-nums text-muted-foreground">
        Ticker Line · loading
      </figcaption>
    </figure>
  );
}

function UnavailableSparkline({ className = "", contained = false, kind }) {
  const providerFailure = kind === "provider";
  return (
    <figure
      data-slot="market-sparkline"
      data-source="Ticker Line"
      className={`${contained ? "w-full" : "w-24 sm:w-[120px]"} ${className}`.trim()}
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

async function fetchSparklineMetadata(sparklineUrl, signal) {
  const metadataUrl = `${sparklineUrl}&metadata=1`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(metadataUrl, {
        headers: { accept: "application/json" },
        signal,
      });
      if (!response.ok) throw new Error(`Ticker Line metadata returned HTTP ${response.status}`);
      const metadata = await response.json();
      if (typeof metadata.dataAsOf !== "string" || !metadata.dataAsOf) {
        throw new Error("Ticker Line metadata did not include an as-of timestamp");
      }
      return metadata.dataAsOf;
    } catch (error) {
      if (signal.aborted || attempt === 1) throw error;
    }
  }
  throw new Error("Ticker Line metadata request failed");
}

function formatSparklineAsOf(dataAsOf) {
  const parsed = new Date(dataAsOf);
  return Number.isNaN(parsed.getTime()) ? dataAsOf : SPARKLINE_DATE_FORMAT.format(parsed);
}
