/*
 * Bundle boundary: consumers MUST load MarketChart with React.lazy(() => import("./market-chart.jsx"));
 * do not eagerly import this module from a page.
 */
import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  HistogramSeries,
  LineSeries,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { SERIES_COLORS } from "../lib/series-colors.js";
import { cn } from "../lib/utils.js";

const RANGE_LABELS = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"];
const TOKEN_NAMES = [
  "foreground",
  "muted-foreground",
  "border",
  "card",
  "background",
  "secondary",
  "success",
  "destructive",
];

function readTokens() {
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    TOKEN_NAMES.map((name) => {
      const value = styles.getPropertyValue(`--tw-${name}`).trim();
      return [name.replaceAll("-", "_"), `hsl(${value})`];
    }),
  );
}

function chartOptions(tokens) {
  return {
    autoSize: true,
    layout: {
      background: { type: "solid", color: tokens.card },
      textColor: tokens.muted_foreground,
    },
    grid: {
      vertLines: { color: tokens.border },
      horzLines: { color: tokens.border },
    },
    rightPriceScale: { borderColor: tokens.border },
    timeScale: { borderColor: tokens.border },
    crosshair: {
      vertLine: { color: tokens.muted_foreground, labelBackgroundColor: tokens.secondary },
      horzLine: { color: tokens.muted_foreground, labelBackgroundColor: tokens.secondary },
    },
  };
}

function singleSeriesOptions(mode, bars, tokens) {
  if (mode === "candlestick") {
    return {
      upColor: tokens.success,
      downColor: tokens.destructive,
      borderUpColor: tokens.success,
      borderDownColor: tokens.destructive,
      wickUpColor: tokens.success,
      wickDownColor: tokens.destructive,
    };
  }
  const rising = (bars.at(-1)?.close ?? 0) >= (bars[0]?.close ?? 0);
  const direction = rising ? tokens.success : tokens.destructive;
  return {
    lineColor: direction,
    topColor: direction,
    bottomColor: tokens.card,
  };
}

function volumeSeriesOptions(tokens) {
  return {
    priceScaleId: "volume",
    priceFormat: { type: "volume" },
    priceLineVisible: false,
    lastValueVisible: false,
    color: tokens.muted_foreground,
  };
}

function toAreaData(bars) {
  return bars.map(({ time, close }) => ({ time, value: close }));
}

function toCandlestickData(bars) {
  return bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
}

function toIndexedData(item) {
  const firstClose = item.bars[0]?.close;
  return item.bars.map((bar, index) => ({
    time: bar.time,
    value:
      item.indexed?.[index] ??
      (Number.isFinite(firstClose) && firstClose !== 0 ? (bar.close / firstClose) * 100 : 0),
  }));
}

function formatValue(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

function formatAriaValue(value) {
  if (!Number.isFinite(value)) return "unavailable";
  return Number(value.toFixed(4)).toString();
}

function formatTime(time, intraday) {
  const iso = new Date(Number(time) * 1000).toISOString();
  return intraday ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

function isIntraday(bars) {
  return bars.length > 1 && Number(bars[1].time) - Number(bars[0].time) < 86_400;
}

function nextRangeIndex(currentIndex, key) {
  if (key === "ArrowRight") return (currentIndex + 1) % RANGE_LABELS.length;
  if (key === "ArrowLeft") return (currentIndex - 1 + RANGE_LABELS.length) % RANGE_LABELS.length;
  return currentIndex;
}

function makeAriaLabel(series, range) {
  const primary = series[0];
  const first = primary?.bars[0]?.close;
  const latest = primary?.bars.at(-1)?.close;
  const change = Number.isFinite(first) && Number.isFinite(latest) ? latest - first : Number.NaN;
  const signedChange = Number.isFinite(change)
    ? `${change >= 0 ? "+" : ""}${formatAriaValue(change)}`
    : "unavailable";
  return [
    `${series.map((item) => item.symbol).join(", ")} market chart`,
    range ? `${range} range` : null,
    `latest close ${formatAriaValue(latest)}`,
    `change ${signedChange}`,
  ]
    .filter(Boolean)
    .join(", ");
}

export function MarketChart({
  series,
  mode,
  prevClose,
  range,
  onRangeChange,
  showVolume = false,
  height = 320,
  className,
}) {
  const renderedSeries = useMemo(
    () => (mode === "indexed" ? series.slice(0, 6) : series.slice(0, 1)),
    [mode, series],
  );
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const tokensRef = useRef(null);
  const priceSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const modeRef = useRef(null);
  const colorBySymbolRef = useRef(null);
  const lineLabelElementsRef = useRef(null);
  const updateLineLabelsRef = useRef(() => {});
  const rangeButtonRefs = useRef([]);
  const propsRef = useRef({ mode, renderedSeries });
  const [tooltip, setTooltip] = useState(null);

  priceSeriesRef.current ??= new Map();
  colorBySymbolRef.current ??= new Map();
  lineLabelElementsRef.current ??= new Map();

  propsRef.current = { mode, renderedSeries };
  updateLineLabelsRef.current = () => {
    const chart = chartRef.current;
    const current = propsRef.current;
    const showLabels =
      current.mode === "indexed" &&
      current.renderedSeries.length >= 2 &&
      current.renderedSeries.length <= 4;
    if (!chart || !showLabels) return;
    const timeScale = chart.timeScale();
    const positions = [];
    for (const item of current.renderedSeries) {
      const element = lineLabelElementsRef.current.get(item.symbol);
      const record = priceSeriesRef.current.get(item.symbol);
      const last = toIndexedData(item).at(-1);
      if (!element || !record || !last) continue;
      const top = record.api.priceToCoordinate(last.value);
      const left = timeScale.timeToCoordinate(last.time);
      if (top == null || left == null) {
        positions.push({ element, top: null, left: null });
        continue;
      }
      positions.push({ element, top, left });
    }
    for (const { element, top, left } of positions) {
      element.hidden = top == null || left == null;
      if (!element.hidden) element.style.cssText = `top: ${top}px; left: ${left}px;`;
    }
  };
  if (mode === "indexed") {
    const usedColors = new Set(
      renderedSeries.flatMap((item) => {
        const color = colorBySymbolRef.current.get(item.symbol);
        return color ? [color] : [];
      }),
    );
    renderedSeries.forEach((item) => {
      if (!colorBySymbolRef.current.has(item.symbol)) {
        const color = SERIES_COLORS.find((candidate) => !usedColors.has(candidate));
        if (color) {
          colorBySymbolRef.current.set(item.symbol, color);
          usedColors.add(color);
        }
      }
    });
  }

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return undefined;

    const tokens = readTokens();
    tokensRef.current = tokens;
    const chart = createChart(container, chartOptions(tokens));
    chartRef.current = chart;

    const onCrosshairMove = (param) => {
      if (!param?.point || param.time == null) {
        setTooltip(null);
        return;
      }
      const current = propsRef.current;
      const primary = current.renderedSeries[0];
      const intraday = isIntraday(primary?.bars ?? []);
      const lines = [formatTime(param.time, intraday)];

      if (current.mode === "indexed") {
        for (const item of current.renderedSeries) {
          const record = priceSeriesRef.current.get(item.symbol);
          const datum = record ? param.seriesData?.get(record.api) : null;
          if (datum && Number.isFinite(datum.value)) {
            lines.push(`${item.symbol} ${formatValue(datum.value)}`);
          }
        }
      } else {
        const record = primary ? priceSeriesRef.current.get(primary.symbol) : null;
        const datum = record ? param.seriesData?.get(record.api) : null;
        if (datum && current.mode === "candlestick") {
          lines.push(
            `O ${formatValue(datum.open)} H ${formatValue(datum.high)} L ${formatValue(datum.low)} C ${formatValue(datum.close)}`,
          );
        } else if (datum && Number.isFinite(datum.value)) {
          lines.push(`Price ${formatValue(datum.value)}`);
        }
      }
      const bar = primary?.bars.find((candidate) => candidate.time === param.time);
      if (Number.isFinite(bar?.volume)) lines.push(`Volume ${formatValue(bar.volume)}`);

      setTooltip({ x: param.point.x, y: param.point.y, lines });
    };

    chart.subscribeCrosshairMove(onCrosshairMove);
    const timeScale = chart.timeScale();
    const onViewportChange = () => updateLineLabelsRef.current();
    timeScale.subscribeVisibleTimeRangeChange(onViewportChange);
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onViewportChange);
    resizeObserver?.observe(container);
    const observer = new MutationObserver(() => {
      const nextTokens = readTokens();
      tokensRef.current = nextTokens;
      chart.applyOptions(chartOptions(nextTokens));
      const current = propsRef.current;
      for (const [symbol, record] of priceSeriesRef.current) {
        if (current.mode === "indexed") {
          record.api.applyOptions({ color: colorBySymbolRef.current.get(symbol) });
        } else {
          const item = current.renderedSeries.find((candidate) => candidate.symbol === symbol);
          record.api.applyOptions(singleSeriesOptions(current.mode, item?.bars ?? [], nextTokens));
        }
      }
      volumeSeriesRef.current?.applyOptions(volumeSeriesOptions(nextTokens));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    return () => {
      observer.disconnect();
      resizeObserver?.disconnect();
      timeScale.unsubscribeVisibleTimeRangeChange(onViewportChange);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.remove();
      if (chartRef.current === chart) chartRef.current = null;
      priceSeriesRef.current.clear();
      volumeSeriesRef.current = null;
      modeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const tokens = tokensRef.current;
    if (!chart || !tokens) return;

    if (modeRef.current !== mode) {
      for (const record of priceSeriesRef.current.values()) chart.removeSeries(record.api);
      priceSeriesRef.current.clear();
      if (volumeSeriesRef.current) chart.removeSeries(volumeSeriesRef.current);
      volumeSeriesRef.current = null;
      modeRef.current = mode;
    }

    const desiredSymbols = new Set(renderedSeries.map((item) => item.symbol));
    for (const [symbol, record] of priceSeriesRef.current) {
      if (!desiredSymbols.has(symbol)) {
        chart.removeSeries(record.api);
        priceSeriesRef.current.delete(symbol);
      }
    }

    for (const item of renderedSeries) {
      let record = priceSeriesRef.current.get(item.symbol);
      if (!record) {
        const definition =
          mode === "area" ? AreaSeries : mode === "candlestick" ? CandlestickSeries : LineSeries;
        const options =
          mode === "indexed"
            ? { color: colorBySymbolRef.current.get(item.symbol) }
            : singleSeriesOptions(mode, item.bars, tokens);
        const api = chart.addSeries(definition, options);
        record = { api, previousClose: null, priceLine: null };
        priceSeriesRef.current.set(item.symbol, record);
      } else if (mode === "indexed") {
        record.api.applyOptions({ color: colorBySymbolRef.current.get(item.symbol) });
      } else {
        record.api.applyOptions(singleSeriesOptions(mode, item.bars, tokens));
      }

      const data =
        mode === "area"
          ? toAreaData(item.bars)
          : mode === "candlestick"
            ? toCandlestickData(item.bars)
            : toIndexedData(item);
      record.api.setData(data);

      if (mode !== "indexed") {
        if (Number.isFinite(prevClose) && record.previousClose !== prevClose) {
          if (record.priceLine) record.api.removePriceLine(record.priceLine);
          record.priceLine = record.api.createPriceLine({
            price: prevClose,
            color: tokens.muted_foreground,
            title: "Prev close",
          });
          record.previousClose = prevClose;
        } else if (!Number.isFinite(prevClose) && record.priceLine) {
          record.api.removePriceLine(record.priceLine);
          record.priceLine = null;
          record.previousClose = null;
        }
      }
    }

    const primary = renderedSeries[0];
    if (mode !== "indexed" && showVolume && primary) {
      if (!volumeSeriesRef.current) {
        volumeSeriesRef.current = chart.addSeries(HistogramSeries, volumeSeriesOptions(tokens));
        chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      }
      volumeSeriesRef.current.setData(
        primary.bars.map(({ time, volume }) => ({ time, value: volume ?? 0 })),
      );
    } else if (volumeSeriesRef.current) {
      chart.removeSeries(volumeSeriesRef.current);
      volumeSeriesRef.current = null;
    }

    chart.timeScale().fitContent();

    updateLineLabelsRef.current();
  }, [mode, prevClose, renderedSeries, showVolume]);

  const ariaLabel = makeAriaLabel(renderedSeries, range);
  const activeRangeIndex = Math.max(0, RANGE_LABELS.indexOf(range));

  return (
    <section
      aria-label={ariaLabel}
      data-slot="market-chart"
      className={cn("relative overflow-hidden", className)}
      style={{ height }}
    >
      <div ref={chartContainerRef} className="absolute inset-0" aria-hidden="true" />

      {renderedSeries.length >= 2 ? (
        <div
          data-slot="market-chart-legend"
          className="pointer-events-none absolute left-2 top-2 z-10 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-card/90 px-2 py-1 text-xs tabular-nums"
        >
          {renderedSeries.map((item) => (
            <div
              key={item.symbol}
              data-symbol={item.symbol}
              className="inline-flex items-center gap-1.5"
            >
              <span
                data-slot="series-color-dot"
                className="size-2 rounded-full"
                style={{ backgroundColor: colorBySymbolRef.current.get(item.symbol) }}
                aria-hidden="true"
              />
              <span className="text-muted-foreground">{item.symbol}</span>
            </div>
          ))}
        </div>
      ) : null}

      {mode === "indexed" && renderedSeries.length >= 2 && renderedSeries.length <= 4 ? (
        <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
          {renderedSeries.map((item) => (
            <div
              key={item.symbol}
              ref={(element) => {
                if (element) lineLabelElementsRef.current.set(item.symbol, element);
                else lineLabelElementsRef.current.delete(item.symbol);
              }}
              data-slot="market-chart-line-label"
              className="absolute inline-flex -translate-y-1/2 items-center gap-1 rounded bg-card/90 px-1.5 py-0.5 text-[11px] tabular-nums text-foreground"
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: colorBySymbolRef.current.get(item.symbol) }}
              />
              <span>{item.symbol}</span>
            </div>
          ))}
        </div>
      ) : null}

      {tooltip ? (
        <div
          data-slot="market-chart-tooltip"
          className="pointer-events-none absolute z-20 rounded-md border border-border bg-card/95 px-2 py-1 text-xs tabular-nums text-foreground shadow-subtle-xs"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          {tooltip.lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      ) : null}

      {onRangeChange ? (
        <div
          data-slot="market-chart-range-selector"
          className="absolute bottom-2 right-2 z-10 flex max-w-[calc(100%-1rem)] gap-1 overflow-x-auto rounded-lg bg-card/90 p-1"
        >
          {RANGE_LABELS.map((label, index) => (
            <button
              key={label}
              ref={(node) => {
                rangeButtonRefs.current[index] = node;
              }}
              type="button"
              aria-pressed={range === label}
              tabIndex={index === activeRangeIndex ? 0 : -1}
              className={cn(
                "min-h-10 min-w-10 rounded-md px-2 text-xs font-medium transition-[background-color,color,box-shadow,scale] duration-150 ease-out active:scale-[0.96]",
                range === label
                  ? "bg-foreground text-background shadow-subtle-xs"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
              onClick={() => onRangeChange(label)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  rangeButtonRefs.current[nextRangeIndex(index, event.key)]?.focus();
                } else if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onRangeChange(label);
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
