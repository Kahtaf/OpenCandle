// @vitest-environment jsdom

import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getChartPriceAutoscaleInfo } from "../../../gui/web/src/components/market-chart-autoscale.js";
import { SERIES_COLORS } from "../../../gui/web/src/lib/series-colors.js";

type MockSeriesApi = {
  definition: unknown;
  options: Record<string, unknown>;
  setData: ReturnType<typeof vi.fn>;
  applyOptions: ReturnType<typeof vi.fn>;
  createPriceLine: ReturnType<typeof vi.fn>;
  removePriceLine: ReturnType<typeof vi.fn>;
  priceToCoordinate: ReturnType<typeof vi.fn>;
};

type MockChartApi = {
  addedSeries: MockSeriesApi[];
  scaleOptions: Map<string, ReturnType<typeof vi.fn>>;
  crosshairCallback: ((param: unknown) => void) | undefined;
  visibleRangeCallback: (() => void) | undefined;
  addSeries: ReturnType<typeof vi.fn>;
  removeSeries: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  applyOptions: ReturnType<typeof vi.fn>;
  priceScale: ReturnType<typeof vi.fn>;
  timeScale: ReturnType<typeof vi.fn>;
  subscribeCrosshairMove: ReturnType<typeof vi.fn>;
  unsubscribeCrosshairMove: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => {
  const AreaSeries = { type: "area" };
  const CandlestickSeries = { type: "candlestick" };
  const LineSeries = { type: "line" };
  const HistogramSeries = { type: "histogram" };
  const charts: MockChartApi[] = [];
  const createChart = vi.fn(() => {
    const addedSeries: MockSeriesApi[] = [];
    const scaleOptions = new Map<string, ReturnType<typeof vi.fn>>();
    const chart: MockChartApi = {
      addedSeries,
      scaleOptions,
      crosshairCallback: undefined as ((param: unknown) => void) | undefined,
      visibleRangeCallback: undefined as (() => void) | undefined,
      addSeries: vi.fn((definition: unknown, options: Record<string, unknown>) => {
        const priceLine = { id: Symbol("price-line") };
        const api = {
          definition,
          options,
          setData: vi.fn(),
          applyOptions: vi.fn(),
          createPriceLine: vi.fn(() => priceLine),
          removePriceLine: vi.fn(),
          priceToCoordinate: vi.fn((value: number) => value),
        };
        addedSeries.push(api);
        return api;
      }),
      removeSeries: vi.fn(),
      remove: vi.fn(),
      applyOptions: vi.fn(),
      priceScale: vi.fn((id: string) => {
        if (!scaleOptions.has(id)) scaleOptions.set(id, vi.fn());
        return { applyOptions: scaleOptions.get(id) };
      }),
      timeScale: vi.fn(() => ({
        timeToCoordinate: vi.fn(() => 480),
        fitContent: vi.fn(),
        subscribeVisibleTimeRangeChange: vi.fn((callback: () => void) => {
          chart.visibleRangeCallback = callback;
        }),
        unsubscribeVisibleTimeRangeChange: vi.fn(),
      })),
      subscribeCrosshairMove: vi.fn((callback: (param: unknown) => void) => {
        chart.crosshairCallback = callback;
      }),
      unsubscribeCrosshairMove: vi.fn(),
    };
    charts.push(chart);
    return chart;
  });
  return { AreaSeries, CandlestickSeries, LineSeries, HistogramSeries, charts, createChart };
});

vi.mock("lightweight-charts", () => ({
  AreaSeries: mocks.AreaSeries,
  CandlestickSeries: mocks.CandlestickSeries,
  LineSeries: mocks.LineSeries,
  HistogramSeries: mocks.HistogramSeries,
  createChart: mocks.createChart,
}));

import { MarketChart } from "../../../gui/web/src/components/market-chart.jsx";

const bars = [
  { time: 1_784_204_100, open: 190, high: 192, low: 189, close: 191, volume: 10_000 },
  { time: 1_784_204_400, open: 191, high: 198, low: 190, close: 197.14, volume: 12_000 },
];

const makeSeries = (symbol: string, offset = 0) => ({
  symbol,
  bars: bars.map((bar) => ({ ...bar, close: bar.close + offset })),
});

type MountedChart = {
  container: HTMLDivElement;
  root: Root;
  render: (element: React.ReactNode) => Promise<void>;
  unmount: () => Promise<void>;
};

async function mount(element: React.ReactNode): Promise<MountedChart> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return {
    container,
    root,
    render: async (next) => act(async () => root.render(next)),
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function chartElement(props: Record<string, unknown> = {}) {
  return React.createElement(MarketChart, {
    series: [makeSeries("AAPL")],
    mode: "area",
    height: 300,
    ...props,
  });
}

function latestChart() {
  const chart = mocks.charts.at(-1);
  if (!chart) throw new Error("Expected MarketChart to create a chart instance");
  return chart;
}

function addedByDefinition(chart: MockChartApi, definition: unknown) {
  return chart.addedSeries.filter((entry) => entry.definition === definition);
}

const mounted: MountedChart[] = [];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.charts.length = 0;
  mocks.createChart.mockClear();
  document.body.replaceChildren();
  document.documentElement.removeAttribute("class");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.cssText = "";
  const tokens = {
    "--tw-foreground": "240 10% 4%",
    "--tw-muted-foreground": "240 4% 46%",
    "--tw-border": "240 6% 90%",
    "--tw-card": "0 0% 100%",
    "--tw-background": "0 0% 98%",
    "--tw-secondary": "240 5% 96%",
    "--tw-success": "142 71% 35%",
    "--tw-destructive": "0 84% 60%",
  };
  for (const [name, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(name, value);
  }
});

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()?.unmount();
  vi.clearAllMocks();
});

describe("MarketChart chart behavior", () => {
  it("maps area bars to time/value points", async () => {
    mounted.push(await mount(chartElement()));

    const area = addedByDefinition(latestChart(), mocks.AreaSeries)[0];
    expect(area.setData).toHaveBeenCalledWith([
      { time: bars[0].time, value: bars[0].close },
      { time: bars[1].time, value: bars[1].close },
    ]);
    expect(area.options.autoscaleInfoProvider).toBeTypeOf("function");
    expect(area.options.autoscaleInfoProvider(() => null)).toEqual(
      getChartPriceAutoscaleInfo(bars, "area"),
    );
  });

  it("maps candlestick bars to OHLC and uses wrapped semantic token colors", async () => {
    mounted.push(await mount(chartElement({ mode: "candlestick" })));

    const candle = addedByDefinition(latestChart(), mocks.CandlestickSeries)[0];
    expect(candle.setData).toHaveBeenCalledWith(
      bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
    );
    expect(candle.options).toMatchObject({
      upColor: "hsl(142 71% 35%)",
      downColor: "hsl(0 84% 60%)",
      wickUpColor: "hsl(142 71% 35%)",
      wickDownColor: "hsl(0 84% 60%)",
    });
    expect(candle.options.autoscaleInfoProvider(() => null)).toEqual(
      getChartPriceAutoscaleInfo(bars, "candlestick"),
    );
  });

  it("rebases indexed series to 100 when no indexed arrays are provided", async () => {
    mounted.push(
      await mount(
        chartElement({ mode: "indexed", series: [makeSeries("AAPL"), makeSeries("MSFT", 40)] }),
      ),
    );

    const lines = addedByDefinition(latestChart(), mocks.LineSeries);
    expect(lines).toHaveLength(2);
    expect(lines[0].options).not.toHaveProperty("autoscaleInfoProvider");
    expect(lines[0].setData).toHaveBeenCalledWith([
      { time: bars[0].time, value: 100 },
      { time: bars[1].time, value: (bars[1].close / bars[0].close) * 100 },
    ]);
    expect(lines[1].setData).toHaveBeenCalledWith([
      { time: bars[0].time, value: 100 },
      { time: bars[1].time, value: ((bars[1].close + 40) / (bars[0].close + 40)) * 100 },
    ]);
  });

  it("assigns indexed identity colors by initial prop position, never semantic tokens", async () => {
    mounted.push(
      await mount(
        chartElement({ mode: "indexed", series: [makeSeries("AAPL"), makeSeries("MSFT")] }),
      ),
    );

    const colors = addedByDefinition(latestChart(), mocks.LineSeries).map(
      (line) => line.options.color,
    );
    expect(colors).toEqual(SERIES_COLORS.slice(0, 2));
    expect(colors).not.toContain("hsl(142 71% 35%)");
    expect(colors).not.toContain("hsl(0 84% 60%)");
  });

  it("keeps survivor colors when the middle indexed series is removed", async () => {
    const first = [makeSeries("AAPL"), makeSeries("MSFT"), makeSeries("NVDA")];
    const view = await mount(chartElement({ mode: "indexed", series: first }));
    mounted.push(view);
    const chart = latestChart();
    const initialLines = addedByDefinition(chart, mocks.LineSeries);

    await view.render(chartElement({ mode: "indexed", series: [first[0], first[2]] }));

    expect(initialLines[0].options.color).toBe(SERIES_COLORS[0]);
    expect(initialLines[2].options.color).toBe(SERIES_COLORS[2]);
    expect(chart.removeSeries).toHaveBeenCalledWith(initialLines[1]);
    expect(addedByDefinition(chart, mocks.LineSeries)).toHaveLength(3);
  });

  it("allocates the first unused palette color to symbols added after a removal", async () => {
    const initial = [makeSeries("A"), makeSeries("B"), makeSeries("C")];
    const view = await mount(chartElement({ mode: "indexed", series: initial }));
    mounted.push(view);
    const chart = latestChart();
    const initialLines = addedByDefinition(chart, mocks.LineSeries);
    expect(initialLines.map((line) => line.options.color)).toEqual(SERIES_COLORS.slice(0, 3));

    await view.render(
      chartElement({ mode: "indexed", series: [makeSeries("D"), initial[1], initial[2]] }),
    );
    const dLine = addedByDefinition(chart, mocks.LineSeries).at(-1);
    expect(dLine?.options.color).toBe(SERIES_COLORS[0]);
    expect(initialLines[1].options.color).toBe(SERIES_COLORS[1]);
    expect(initialLines[2].options.color).toBe(SERIES_COLORS[2]);

    await view.render(
      chartElement({
        mode: "indexed",
        series: [makeSeries("D"), initial[1], initial[2], makeSeries("E")],
      }),
    );
    const indexedColors = [
      dLine?.options.color,
      initialLines[1].options.color,
      initialLines[2].options.color,
      addedByDefinition(chart, mocks.LineSeries).at(-1)?.options.color,
    ];
    expect(indexedColors[3]).toBe(SERIES_COLORS[3]);
    expect(new Set(indexedColors)).toHaveLength(4);
  });

  it.each([2, 3, 4])("renders direct line-end labels for %i indexed series", async (count) => {
    const view = await mount(
      chartElement({
        mode: "indexed",
        series: Array.from({ length: count }, (_, index) => makeSeries(`SYM${index}`)),
      }),
    );
    mounted.push(view);

    const labels = [...view.container.querySelectorAll('[data-slot="market-chart-line-label"]')];
    expect(labels).toHaveLength(count);
    expect(labels.map((label) => label.textContent)).toEqual(
      Array.from({ length: count }, (_, index) => `SYM${index}`),
    );
  });

  it("repositions direct labels when the visible time range changes", async () => {
    const view = await mount(
      chartElement({ mode: "indexed", series: [makeSeries("AAPL"), makeSeries("MSFT")] }),
    );
    mounted.push(view);
    const chart = latestChart();
    const labels = [...view.container.querySelectorAll('[data-slot="market-chart-line-label"]')];
    expect(chart.visibleRangeCallback).toBeTypeOf("function");
    expect((labels[0] as HTMLElement).style.top).not.toBe("");

    addedByDefinition(chart, mocks.LineSeries)[0].priceToCoordinate.mockReturnValue(42);
    await act(async () => chart.visibleRangeCallback?.());

    expect((labels[0] as HTMLElement).style.top).toBe("42px");
  });

  it.each([5, 6])("omits direct line-end labels for %i indexed series", async (count) => {
    const view = await mount(
      chartElement({
        mode: "indexed",
        series: Array.from({ length: count }, (_, index) => makeSeries(`SYM${index}`)),
      }),
    );
    mounted.push(view);

    expect(view.container.querySelectorAll('[data-slot="market-chart-line-label"]')).toHaveLength(
      0,
    );
  });

  it("creates a previous-close line in single-series mode", async () => {
    mounted.push(await mount(chartElement({ prevClose: 197.14 })));

    const area = addedByDefinition(latestChart(), mocks.AreaSeries)[0];
    expect(area.createPriceLine).toHaveBeenCalledWith(expect.objectContaining({ price: 197.14 }));
  });

  it("replaces a changed previous-close line and removes it when no longer finite", async () => {
    const view = await mount(chartElement({ prevClose: 100 }));
    mounted.push(view);
    const area = addedByDefinition(latestChart(), mocks.AreaSeries)[0];
    const firstLine = area.createPriceLine.mock.results[0]?.value;

    await view.render(chartElement({ prevClose: 101 }));
    expect(area.removePriceLine).toHaveBeenCalledWith(firstLine);
    expect(area.createPriceLine).toHaveBeenLastCalledWith(expect.objectContaining({ price: 101 }));

    const secondLine = area.createPriceLine.mock.results[1]?.value;
    await view.render(chartElement({ prevClose: undefined }));
    expect(area.removePriceLine).toHaveBeenLastCalledWith(secondLine);
    expect(area.createPriceLine).toHaveBeenCalledTimes(2);
  });

  it("confines volume to a dedicated hidden-axis bottom scale", async () => {
    mounted.push(await mount(chartElement({ mode: "candlestick", showVolume: true })));

    const chart = latestChart();
    const volume = addedByDefinition(chart, mocks.HistogramSeries)[0];
    expect(volume.options).toMatchObject({
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    expect(chart.priceScale).toHaveBeenCalledWith("volume");
    expect(chart.scaleOptions.get("volume")).toHaveBeenCalledWith({
      scaleMargins: { top: 0.82, bottom: 0.02 },
    });
    expect(mocks.createChart.mock.calls.at(-1)?.[1]).not.toHaveProperty("leftPriceScale");
  });

  it("uses sparse horizontal token gridlines and keeps the mobile price scale visible", async () => {
    mounted.push(await mount(chartElement()));

    expect(mocks.createChart.mock.calls.at(-1)?.[1]).toMatchObject({
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      layout: { textColor: "hsl(240 4% 46%)" },
      rightPriceScale: {
        visible: true,
        minimumWidth: 56,
        scaleMargins: { top: 0.12, bottom: 0.08 },
      },
    });
  });

  it("formats the price axis with separators and disables the in-plot attribution logo", async () => {
    mounted.push(await mount(chartElement()));

    const options = mocks.createChart.mock.calls.at(-1)?.[1];
    expect(options.layout.attributionLogo).toBe(false);
    expect(options.localization.priceFormatter(63_086.42)).toBe("63,086");
    expect(options.localization.priceFormatter(216)).toBe("216.00");
  });

  it("renders hovered candlestick details as an absolutely positioned tabular overlay", async () => {
    const view = await mount(chartElement({ mode: "candlestick", showVolume: true }));
    mounted.push(view);
    const chart = latestChart();
    const candle = addedByDefinition(chart, mocks.CandlestickSeries)[0];

    await act(async () => {
      chart.crosshairCallback({
        point: { x: 120, y: 80 },
        time: bars[0].time,
        seriesData: new Map([[candle, bars[0]]]),
      });
    });

    const tooltip = view.container.querySelector('[data-slot="market-chart-tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.className).toContain("absolute");
    expect(tooltip?.className).toContain("pointer-events-none");
    expect(tooltip?.className).toContain("tabular-nums");
    expect(tooltip?.textContent).toContain("2026-07-16 12:15");
    expect(tooltip?.textContent).toContain("O 190.00");
    expect(tooltip?.textContent).toContain("H 192.00");
    expect(tooltip?.textContent).toContain("L 189.00");
    expect(tooltip?.textContent).toContain("C 191.00");
    expect(tooltip?.textContent).toContain("Volume 10K");
  });

  it("moves range focus with arrows and activates the focused range with Enter", async () => {
    const onRangeChange = vi.fn();
    const view = await mount(chartElement({ range: "1D", onRangeChange }));
    mounted.push(view);
    const oneDay = [...view.container.querySelectorAll("button")].find(
      (button) => button.textContent === "1D",
    ) as HTMLButtonElement;
    const fiveDay = [...view.container.querySelectorAll("button")].find(
      (button) => button.textContent === "5D",
    ) as HTMLButtonElement;
    oneDay.focus();

    await act(async () => {
      oneDay.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(document.activeElement).toBe(fiveDay);
    await act(async () => {
      fiveDay.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onRangeChange).toHaveBeenCalledWith("5D");
  });

  it("keeps the selector keyboard-reachable when no range label is active", async () => {
    const view = await mount(chartElement({ onRangeChange: vi.fn() }));
    mounted.push(view);
    const buttons = [...view.container.querySelectorAll("button")];
    const tabbable = buttons.filter((button) => button.tabIndex === 0);

    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]?.textContent).toBe("1D");
  });

  it("removes each chart exactly once on ordinary and StrictMode unmounts", async () => {
    const ordinary = await mount(chartElement());
    await ordinary.unmount();
    expect(mocks.charts).toHaveLength(1);
    expect(mocks.charts[0].remove).toHaveBeenCalledTimes(1);

    mocks.charts.length = 0;
    const strict = await mount(React.createElement(StrictMode, null, chartElement()));
    await strict.unmount();
    expect(mocks.charts.length).toBeGreaterThanOrEqual(2);
    for (const chart of mocks.charts) expect(chart.remove).toHaveBeenCalledTimes(1);
  });
});
