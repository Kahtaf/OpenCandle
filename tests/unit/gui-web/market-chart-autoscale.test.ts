import { describe, expect, it } from "vitest";
import {
  getChartPriceAutoscaleInfo,
  PRICE_SCALE_MARGINS,
} from "../../../gui/web/src/components/market-chart-autoscale.js";

function displayedRange(autoscaleInfo) {
  const providerRange = autoscaleInfo.priceRange;
  const chartRatio = 1 - PRICE_SCALE_MARGINS.top - PRICE_SCALE_MARGINS.bottom;
  const displaySpan = (providerRange.maxValue - providerRange.minValue) / chartRatio;
  return {
    minValue: providerRange.minValue - PRICE_SCALE_MARGINS.bottom * displaySpan,
    maxValue: providerRange.maxValue + PRICE_SCALE_MARGINS.top * displaySpan,
  };
}

describe("market chart price autoscale", () => {
  it.each(["area", "line"])("pads %s close values without introducing a zero floor", (mode) => {
    expect(
      getChartPriceAutoscaleInfo(
        [
          { close: 149, low: 1, high: 700 },
          { close: 584, low: 1, high: 700 },
        ],
        mode,
      ),
    ).toEqual({ priceRange: { minValue: 127.25, maxValue: 605.75 } });
  });

  it("uses candle lows and highs for the padded range", () => {
    expect(
      getChartPriceAutoscaleInfo(
        [
          { close: 149, low: 145, high: 160 },
          { close: 584, low: 570, high: 590 },
        ],
        "candlestick",
      ),
    ).toEqual({ priceRange: { minValue: 122.75, maxValue: 612.25 } });
  });

  it("gives a flat positive series symmetric breathing room without forcing zero", () => {
    expect(getChartPriceAutoscaleInfo([{ close: 100 }, { close: 100 }], "area")).toEqual({
      priceRange: { minValue: 95, maxValue: 105 },
    });
  });

  it("keeps the displayed range above zero when positive long-range data approaches zero", () => {
    const autoscaleInfo = getChartPriceAutoscaleInfo([{ close: 1.81 }, { close: 516.1 }], "area");

    expect(displayedRange(autoscaleInfo).minValue).toBeGreaterThan(0);
  });

  it("leaves indexed mode and empty data on the chart library defaults", () => {
    expect(getChartPriceAutoscaleInfo([{ close: 100 }], "indexed")).toBeNull();
    expect(getChartPriceAutoscaleInfo([], "area")).toBeNull();
  });
});
