export const ALERT_CONDITION_VERSION = 1;

export type AlertCondition =
  | ReturnType<typeof priceCrossesAbove>
  | ReturnType<typeof priceCrossesBelow>
  | ReturnType<typeof percentMove>
  | ReturnType<typeof priceCrossesSma>
  | ReturnType<typeof smaCross>
  | ReturnType<typeof rsiThreshold>
  | ReturnType<typeof volumeSpike>;

export function priceCrossesAbove(threshold: number): {
  threshold: number;
  field: "last_price";
} {
  return { threshold, field: "last_price" };
}

export function priceCrossesBelow(threshold: number): {
  threshold: number;
  field: "last_price";
} {
  return { threshold, field: "last_price" };
}

export function percentMove(
  direction: "up" | "down",
  percent: number,
  window = "1d",
): {
  direction: "up" | "down";
  percent: number;
  window: string;
} {
  return { direction, percent, window };
}

export function priceCrossesSma(
  period: number,
  direction: "above" | "below",
  priceField: "close" | "last_price" = "close",
): {
  period: number;
  direction: "above" | "below";
  price_field: "close" | "last_price";
} {
  return { period, direction, price_field: priceField };
}

export function smaCross(
  fastPeriod: number,
  slowPeriod: number,
  direction: "above" | "below",
): {
  fast_period: number;
  slow_period: number;
  direction: "above" | "below";
} {
  return { fast_period: fastPeriod, slow_period: slowPeriod, direction };
}

export function rsiThreshold(
  period: number,
  threshold: number,
  direction: "above" | "below",
): {
  period: number;
  threshold: number;
  direction: "above" | "below";
} {
  return { period, threshold, direction };
}

export function volumeSpike(
  lookbackPeriod: number,
  multiplier: number,
): {
  lookback_period: number;
  multiplier: number;
} {
  return { lookback_period: lookbackPeriod, multiplier };
}
