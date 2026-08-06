import { useEffect, useRef, useState } from "react";
import {
  isTickerLineSvg,
  readTickerLineTextWithLimit,
  TICKER_LINE_MAX_JSON_BYTES,
  TICKER_LINE_MAX_SVG_BYTES,
  tickerLineProviderSparklineUrl,
  tickerLineProxySparklineUrl,
  tickerLineResponseFailure,
} from "../../../shared/ticker-line.ts";
import { useRuntimeTransport } from "../runtime/runtime-transport-context.js";
import { Skeleton } from "./ui/skeleton.jsx";

const SPARKLINE_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const SPARKLINE_REFRESH_INTERVAL_MS = 5 * 60_000;
const SPARKLINE_REQUEST_TIMEOUT_MS = 10_000;

export function MarketSparkline({ symbol, assetType, className = "" }) {
  const transport = useRuntimeTransport();
  const isHosted = transport.kind === "hosted";
  const sparklineUrl = isHosted
    ? tickerLineProviderSparklineUrl(symbol, assetType)
    : tickerLineProxySparklineUrl(symbol, assetType);

  if (!sparklineUrl) {
    return <UnavailableSparkline className={className} kind="unsupported" />;
  }

  return (
    <TickerLineSparkline
      key={sparklineUrl}
      symbol={symbol}
      sparklineUrl={sparklineUrl}
      metadataUrl={`${sparklineUrl}&${isHosted ? "format=json" : "metadata=1"}`}
      renderSvgFromMetadata={isHosted}
      className={className}
    />
  );
}

function TickerLineSparkline({
  symbol,
  sparklineUrl,
  metadataUrl,
  renderSvgFromMetadata,
  className,
}) {
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
        const result = await fetchSparklineMetadata(
          metadataUrl,
          controller.signal,
          renderSvgFromMetadata,
        );
        if (!controller.signal.aborted) {
          setFailureCount(0);
          setMetadata({ status: "ok", ...result });
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
  }, [isVisible, metadataUrl, renderSvgFromMetadata]);

  let content;
  if (metadata.status === "loading") {
    content = <PendingSparkline contained />;
  } else if (metadata.status === "failed" || failureCount > 1) {
    content = <UnavailableSparkline contained kind="provider" />;
  } else {
    const versionedImageUrl =
      metadata.imageUrl ?? `${sparklineUrl}&asOf=${encodeURIComponent(metadata.dataAsOf)}`;
    const imageUrl =
      failureCount === 0
        ? versionedImageUrl
        : `${versionedImageUrl}${metadata.imageUrl ? "#" : "&"}retry=${failureCount}`;
    const asOf = formatSparklineAsOf(metadata.dataAsOf);
    content = (
      // The per-row caption is deliberately gone; freshness for a saved list is
      // stated once by its quote badge. The as-of stays reachable on the chart
      // itself, by hover as well as by assistive technology, so it is not
      // available only to one of them.
      <div
        data-slot="market-sparkline"
        data-state="ready"
        className="w-full"
        title={`Price chart as of ${asOf}`}
      >
        <img
          src={imageUrl}
          alt={`${symbol} 1-day price chart, data as of ${asOf}`}
          width="120"
          height="30"
          crossOrigin="anonymous"
          loading="lazy"
          decoding="async"
          onError={() => setFailureCount((count) => count + 1)}
          className="block h-[29px] w-24 object-contain sm:h-9 sm:w-[120px]"
        />
      </div>
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
    <div
      data-slot="market-sparkline"
      data-state="loading"
      className={`${contained ? "w-full" : "w-24 sm:w-[120px]"} ${className}`.trim()}
      role="status"
      aria-label="Loading price chart"
    >
      <Skeleton className="h-[29px] w-24 sm:h-9 sm:w-[120px]" />
    </div>
  );
}

function UnavailableSparkline({ className = "", contained = false, kind }) {
  const providerFailure = kind === "provider";
  return (
    <div
      data-slot="market-sparkline"
      data-state="unavailable"
      className={`${contained ? "w-full" : "w-24 sm:w-[120px]"} ${className}`.trim()}
      title={
        providerFailure
          ? "Price chart is temporarily unavailable"
          : "Price chart is not available for this instrument"
      }
    >
      <div className="flex h-[29px] items-center text-[10px] text-muted-foreground sm:h-9">
        Unavailable
      </div>
    </div>
  );
}

async function fetchSparklineMetadata(metadataUrl, signal, requireSvg) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const request = createBoundedRequestSignal(signal);
    try {
      const response = await fetch(metadataUrl, {
        headers: { accept: "application/json" },
        signal: request.signal,
      });
      if (!response.ok) throw new Error(`Ticker Line metadata returned HTTP ${response.status}`);
      const responseFailure = tickerLineResponseFailure(response.headers);
      if (responseFailure) throw new Error(responseFailure);
      const body = await readTickerLineTextWithLimit(response, TICKER_LINE_MAX_JSON_BYTES);
      if (body.status === "too_large") {
        throw new Error("Ticker Line metadata exceeded the size limit");
      }
      const metadata = JSON.parse(body.text);
      if (typeof metadata.dataAsOf !== "string" || !metadata.dataAsOf) {
        throw new Error("Ticker Line metadata did not include an as-of timestamp");
      }
      if (!requireSvg) return { dataAsOf: metadata.dataAsOf };
      if (
        typeof metadata.svg !== "string" ||
        new TextEncoder().encode(metadata.svg).byteLength > TICKER_LINE_MAX_SVG_BYTES ||
        !isTickerLineSvg(metadata.svg)
      ) {
        throw new Error("Ticker Line metadata did not include a valid SVG");
      }
      return {
        dataAsOf: metadata.dataAsOf,
        imageUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(metadata.svg)}`,
      };
    } catch (error) {
      if (signal.aborted || attempt === 1) throw error;
    } finally {
      request.dispose();
    }
  }
  throw new Error("Ticker Line metadata request failed");
}

function createBoundedRequestSignal(parentSignal) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal.aborted) abortFromParent();
  else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  const timeout = window.setTimeout(
    () => controller.abort(new DOMException("Ticker Line request timed out", "TimeoutError")),
    SPARKLINE_REQUEST_TIMEOUT_MS,
  );
  return {
    signal: controller.signal,
    dispose() {
      window.clearTimeout(timeout);
      parentSignal.removeEventListener("abort", abortFromParent);
    },
  };
}

function formatSparklineAsOf(dataAsOf) {
  const parsed = new Date(dataAsOf);
  return Number.isNaN(parsed.getTime()) ? dataAsOf : SPARKLINE_DATE_FORMAT.format(parsed);
}
