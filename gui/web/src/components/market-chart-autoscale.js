const DEFAULT_PRICE_PADDING_RATIO = 0.05;
export const PRICE_SCALE_MARGINS = { top: 0.12, bottom: 0.08 };

export function getChartPriceAutoscaleInfo(bars, mode, paddingRatio = DEFAULT_PRICE_PADDING_RATIO) {
  if (mode === "indexed" || !Array.isArray(bars) || bars.length === 0) return null;

  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  const isCandlestick = mode === "candlestick";

  for (const bar of bars) {
    const low = isCandlestick ? bar?.low : bar?.close;
    const high = isCandlestick ? bar?.high : bar?.close;
    if (Number.isFinite(low)) minValue = Math.min(minValue, low);
    if (Number.isFinite(high)) maxValue = Math.max(maxValue, high);
  }

  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return null;
  const ratio =
    Number.isFinite(paddingRatio) && paddingRatio >= 0 ? paddingRatio : DEFAULT_PRICE_PADDING_RATIO;
  const span = maxValue - minValue;
  const padding = (span > 0 ? span : Math.max(Math.abs(minValue), Math.abs(maxValue), 1)) * ratio;
  let autoscaleMin = minValue - padding;
  let autoscaleMax = maxValue + padding;
  const chartRatio = 1 - PRICE_SCALE_MARGINS.top - PRICE_SCALE_MARGINS.bottom;
  const bottomMarginRatio = PRICE_SCALE_MARGINS.bottom / chartRatio;
  const topMarginRatio = PRICE_SCALE_MARGINS.top / chartRatio;
  // Scale margins expand the displayed range beyond the provider range. Compensate only when
  // that expansion would introduce zero for data that stays entirely on one side of it.
  const projectedDisplayMin = autoscaleMin - bottomMarginRatio * (autoscaleMax - autoscaleMin);
  if (minValue > 0 && projectedDisplayMin <= 0) {
    const targetDisplayMin = Math.max(minValue - padding, minValue * 0.5);
    autoscaleMin = (targetDisplayMin + bottomMarginRatio * autoscaleMax) / (1 + bottomMarginRatio);
  }

  const projectedDisplayMax = autoscaleMax + topMarginRatio * (autoscaleMax - autoscaleMin);
  if (maxValue < 0 && projectedDisplayMax >= 0) {
    const targetDisplayMax = Math.min(maxValue + padding, maxValue * 0.5);
    autoscaleMax = (targetDisplayMax + topMarginRatio * autoscaleMin) / (1 + topMarginRatio);
  }

  return {
    priceRange: {
      minValue: autoscaleMin,
      maxValue: autoscaleMax,
    },
  };
}
