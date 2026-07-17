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
import {
  formatChartPrice,
  formatCompactNumber,
  formatNumber,
  formatPrice,
} from "../lib/financial-format.js";
import { SERIES_COLORS } from "../lib/series-colors.js";
import { cn } from "../lib/utils.js";
import { getChartPriceAutoscaleInfo, PRICE_SCALE_MARGINS } from "./market-chart-autoscale.js";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs.jsx";

const RANGE_LABELS = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"];
const GRID_ROWS = ["20", "40", "60", "80", "100"];
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
  const tokens = Object.fromEntries(
    TOKEN_NAMES.map((name) => {
      const value = styles.getPropertyValue(`--tw-${name}`).trim();
      return [name.replaceAll("-", "_"), `hsl(${value})`];
    }),
  );
  const mutedForeground = styles.getPropertyValue("--tw-muted-foreground").trim();
  return {
    ...tokens,
    volume: `hsl(${mutedForeground} / 0.35)`,
  };
}

function chartOptions(tokens) {
  return {
    autoSize: true,
    layout: {
      background: { type: "solid", color: tokens.card },
      textColor: tokens.muted_foreground,
      attributionLogo: false,
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { visible: false },
    },
    localization: { priceFormatter: formatChartPrice },
    rightPriceScale: {
      visible: true,
      minimumWidth: 56,
      borderColor: tokens.border,
      scaleMargins: { ...PRICE_SCALE_MARGINS },
    },
    timeScale: { borderColor: tokens.border },
    crosshair: {
      vertLine: { color: tokens.muted_foreground, labelBackgroundColor: tokens.secondary },
      horzLine: { color: tokens.muted_foreground, labelBackgroundColor: tokens.secondary },
    },
  };
}

function singleSeriesOptions(mode, bars, tokens) {
  const autoscaleInfo = getChartPriceAutoscaleInfo(bars, mode);
  const autoscaleInfoProvider = () => autoscaleInfo;
  if (mode === "candlestick") {
    return {
      autoscaleInfoProvider,
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
    autoscaleInfoProvider,
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
    color: tokens.volume,
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
  return formatPrice(value, null);
}

function formatAriaValue(value) {
  if (!Number.isFinite(value)) return "unavailable";
  return formatNumber(value, { maximumFractionDigits: 4 });
}

function formatTime(time, intraday) {
  const iso = new Date(Number(time) * 1000).toISOString();
  return intraday ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

function isIntraday(bars) {
  return bars.length > 1 && Number(bars[1].time) - Number(bars[0].time) < 86_400;
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
  const propsRef = useRef({ mode, renderedSeries });
  const [tooltip, setTooltip] = useState(null);

  priceSeriesRef.current ??= new Map();
  colorBySymbolRef.current ??= new Map();
  lineLabelElementsRef.current ??= new Map();

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
    propsRef.current = { mode, renderedSeries };
    updateLineLabelsRef.current = () => {
      const chart = chartRef.current;
      const showLabels =
        mode === "indexed" && renderedSeries.length >= 2 && renderedSeries.length <= 4;
      if (!chart || !showLabels) return;
      const timeScale = chart.timeScale();
      const positions = [];
      for (const item of renderedSeries) {
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
    updateLineLabelsRef.current();
  }, [mode, renderedSeries]);

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
      if (Number.isFinite(bar?.volume)) lines.push(`Volume ${formatCompactNumber(bar.volume)}`);

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
      const seriesBySymbol = new Map(current.renderedSeries.map((item) => [item.symbol, item]));
      for (const [symbol, record] of priceSeriesRef.current) {
        if (current.mode === "indexed") {
          record.api.applyOptions({ color: colorBySymbolRef.current.get(symbol) });
        } else {
          const item = seriesBySymbol.get(symbol);
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
        chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0.02 } });
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
  const activeRange = RANGE_LABELS.includes(range) ? range : RANGE_LABELS[0];

  return (
    <section
      aria-label={ariaLabel}
      data-slot="market-chart"
      className={cn("relative flex min-h-0 flex-col overflow-hidden tabular-nums", className)}
      style={{ height }}
    >
      {onRangeChange ? (
        <Tabs
          value={activeRange}
          onValueChange={onRangeChange}
          data-slot="market-chart-range-selector"
          className="relative flex min-h-12 flex-none items-center justify-end border-b border-border bg-card"
        >
          <div
            data-slot="market-chart-range-scroll"
            className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <TabsList className="ml-auto h-10 w-max min-w-full justify-end bg-transparent p-0">
              {RANGE_LABELS.map((label) => (
                <TabsTrigger
                  key={label}
                  value={label}
                  tabIndex={label === activeRange ? 0 : -1}
                  className="min-h-10 min-w-10 px-2 text-xs transition-[background-color,color,box-shadow,transform,scale] duration-150 ease-out active:scale-[0.96]"
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <span
            data-slot="market-chart-range-fade"
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-card to-transparent sm:hidden"
          />
        </Tabs>
      ) : null}

      <div data-slot="market-chart-plot" className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={chartContainerRef} className="absolute inset-0" aria-hidden="true" />
        <div
          data-slot="market-chart-horizontal-grid"
          aria-hidden="true"
          className="pointer-events-none absolute bottom-7 left-0 right-14 top-0 z-[1] grid grid-rows-5"
        >
          {GRID_ROWS.map((row) => (
            <span
              key={row}
              data-slot="market-chart-grid-row"
              className="border-b border-border/45"
            />
          ))}
        </div>

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
      </div>

      <div
        data-slot="market-chart-attribution"
        className="flex h-10 flex-none items-center border-t border-border bg-card px-2"
      >
        <a
          href="https://www.tradingview.com/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-10 items-center rounded-sm px-1 text-[10px] text-muted-foreground transition-[color,transform,scale] duration-150 ease-out hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Charts by TradingView
        </a>
      </div>
    </section>
  );
}
