import { formatCompactNumber, formatNumber } from "../../lib/financial-format.js";
import { shortDateLabel } from "../market-state/format.js";

// Every derivation below reads daily price history the page already fetched.
// Nothing here estimates, extrapolates or invents a level: a stat that the
// history cannot support is left out of the result entirely, so the page can
// omit it rather than print a zero, a dash or a guess.
//
// @typedef {{ time: number, open: number, high: number, low: number, close: number, volume: number }} HistoryBar

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365;
// A daily series may miss the exact target date (weekends, holidays, a range
// that starts one session late). Each horizon tolerates a fifth of its own
// window, capped at a week, so a real one-year fetch still counts as covering
// a year while a three-day history never passes as a week.
const MAX_COVERAGE_TOLERANCE_MS = 7 * DAY_MS;
const COVERAGE_TOLERANCE_RATIO = 0.2;
// Daily bars sit at least a day apart. Anything denser is intraday history,
// which cannot back a "20-day average" or a 52-week range.
const MIN_DAILY_GAP_MS = 20 * 60 * 60_000;
const VOLUME_AVERAGE_DAYS = 30;

const TREND_PERIODS = [20, 50, 200];

/**
 * @param {HistoryBar[]} bars
 * @returns {Array<HistoryBar & { timeMs: number }>}
 */
function normalizeBars(bars) {
  const list = Array.isArray(bars) ? bars : [];
  return list
    .filter(
      (bar) =>
        Number.isFinite(bar?.time) && bar.time > 0 && Number.isFinite(bar?.close) && bar.close > 0,
    )
    .map((bar) => ({ ...bar, timeMs: bar.time * 1000 }))
    .sort((a, b) => a.timeMs - b.timeMs);
}

function isDailySeries(bars) {
  if (bars.length < 2) return false;
  const gaps = [];
  for (let index = 1; index < bars.length; index += 1) {
    gaps.push(bars[index].timeMs - bars[index - 1].timeMs);
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return median >= MIN_DAILY_GAP_MS;
}

function toleranceFor(windowMs) {
  return Math.min(MAX_COVERAGE_TOLERANCE_MS, windowMs * COVERAGE_TOLERANCE_RATIO);
}

/**
 * The close of the last bar at or before `targetMs`, or null when the history
 * does not reach back far enough to answer for that horizon.
 */
function baselineClose(bars, targetMs, latestMs) {
  const earliest = bars[0];
  if (!earliest) return null;
  const tolerance = toleranceFor(Math.max(latestMs - targetMs, 0));
  if (earliest.timeMs > targetMs + tolerance) return null;
  let chosen = null;
  for (const bar of bars) {
    if (bar.timeMs > targetMs) break;
    chosen = bar;
  }
  return (chosen ?? earliest).close;
}

function shiftMonths(timeMs, months) {
  const date = new Date(timeMs);
  const shifted = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() - months,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
    ),
  );
  return shifted.getTime();
}

function percentChange(current, baseline) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline <= 0) return null;
  const percent = (current / baseline - 1) * 100;
  return Number.isFinite(percent) ? percent : null;
}

function resolveCurrentPrice(bars, options = {}) {
  const supplied = options.currentPrice;
  if (Number.isFinite(supplied) && supplied > 0) return supplied;
  const last = bars.at(-1);
  return last ? last.close : null;
}

/** Bars inside the trailing 52-week window, or null when the window is not covered. */
function window52Weeks(bars) {
  const latest = bars.at(-1);
  if (!latest) return null;
  const targetMs = latest.timeMs - YEAR_DAYS * DAY_MS;
  if (bars[0].timeMs > targetMs + toleranceFor(YEAR_DAYS * DAY_MS)) return null;
  return bars.filter((bar) => bar.timeMs >= targetMs);
}

// The daily series can still end at the previous session while the quote
// already carries the current one, so the live price and the session's own
// range join the 52-week window. A figure that is not a usable price is left
// out rather than dragging the range to zero.
function sessionExtreme(options, key, current) {
  const value = options?.[key];
  return Number.isFinite(value) && value > 0 ? value : current;
}

function highOf(bar) {
  return Number.isFinite(bar.high) && bar.high > 0 ? bar.high : bar.close;
}

function lowOf(bar) {
  return Number.isFinite(bar.low) && bar.low > 0 ? bar.low : bar.close;
}

/**
 * Horizon returns in a fixed order. Horizons the history cannot reach are
 * absent from the result rather than reported as zero.
 *
 * @param {HistoryBar[]} bars daily bars
 * @param {{ currentPrice?: number }} [options]
 * @returns {Array<{ key: string, percent: number }>}
 */
export function deriveHorizonReturns(bars, options = {}) {
  const normalized = normalizeBars(bars);
  if (!isDailySeries(normalized)) return [];
  const latest = normalized.at(-1);
  const current = resolveCurrentPrice(normalized, options);
  if (!latest || !Number.isFinite(current)) return [];

  const entries = [];
  const push = (key, baseline) => {
    const percent = percentChange(current, baseline);
    if (percent != null) entries.push({ key, percent });
  };

  push("week", baselineClose(normalized, latest.timeMs - 7 * DAY_MS, latest.timeMs));
  push("month", baselineClose(normalized, shiftMonths(latest.timeMs, 1), latest.timeMs));

  // Year to date compares with the last close of the previous calendar year.
  // There is no tolerance to give here: either the previous year was fetched
  // or the horizon is not computable.
  const yearStartMs = Date.UTC(new Date(latest.timeMs).getUTCFullYear(), 0, 1);
  if (normalized[0].timeMs < yearStartMs) {
    let priorYearClose = null;
    for (const bar of normalized) {
      if (bar.timeMs >= yearStartMs) break;
      priorYearClose = bar.close;
    }
    push("ytd", priorYearClose);
  }

  push("year", baselineClose(normalized, shiftMonths(latest.timeMs, 12), latest.timeMs));

  const window = window52Weeks(normalized);
  if (window && window.length > 0) {
    // The distance is measured from the highest price of the last 52 weeks,
    // including the current session, so a high set today and given back since
    // still reads as the high it was.
    const high = Math.max(
      current,
      sessionExtreme(options, "sessionHigh", current),
      ...window.map(highOf),
    );
    const percent = percentChange(current, high);
    if (percent != null) entries.push({ key: "fromHigh52w", percent });
  }

  return entries;
}

/**
 * Session volume next to its 30-day average.
 *
 * @returns {{ volume: number, averageVolume: number | null, multiple: number | null } | null}
 */
export function deriveVolumeContext(bars, options = {}) {
  const normalized = normalizeBars(bars);
  const supplied = options.volume;
  const latest = normalized.at(-1);
  const volume =
    Number.isFinite(supplied) && supplied > 0
      ? supplied
      : Number.isFinite(latest?.volume) && latest.volume > 0
        ? latest.volume
        : null;
  // Instruments that report no volume at all (currency pairs, most indices)
  // say so by absence instead of printing a zero.
  if (volume == null) return null;

  if (!isDailySeries(normalized)) return { volume, averageVolume: null, multiple: null };
  const prior = normalized.slice(0, -1).slice(-VOLUME_AVERAGE_DAYS);
  const usable = prior.filter((bar) => Number.isFinite(bar.volume) && bar.volume >= 0);
  if (usable.length < VOLUME_AVERAGE_DAYS) {
    return { volume, averageVolume: null, multiple: null };
  }
  const averageVolume = usable.reduce((sum, bar) => sum + bar.volume, 0) / usable.length;
  if (!Number.isFinite(averageVolume) || averageVolume <= 0) {
    return { volume, averageVolume: null, multiple: null };
  }
  return { volume, averageVolume, multiple: volume / averageVolume };
}

/** "12.4M · 0.8× avg", or just the volume when no average is computable. */
export function formatVolumeContext(context) {
  if (!context || !Number.isFinite(context.volume)) return null;
  const volume = formatCompactNumber(context.volume);
  if (!Number.isFinite(context.multiple)) return volume;
  const multiple = formatNumber(context.multiple, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${volume} · ${multiple}× avg`;
}

function movingAverage(bars, period) {
  if (bars.length < period) return null;
  const window = bars.slice(-period);
  const average = window.reduce((sum, bar) => sum + bar.close, 0) / window.length;
  return Number.isFinite(average) ? average : null;
}

/**
 * The 52-week range and the 20/50-day averages, each with the signed distance
 * from the current price. Levels the history cannot support are omitted.
 *
 * @returns {Array<{ key: string, label: string, value: number, distancePercent: number }>}
 */
export function deriveKeyLevels(bars, options = {}) {
  const normalized = normalizeBars(bars);
  if (!isDailySeries(normalized)) return [];
  const current = resolveCurrentPrice(normalized, options);
  if (!Number.isFinite(current) || current <= 0) return [];

  const levels = [];
  const push = (key, label, value) => {
    if (!Number.isFinite(value) || value <= 0) return;
    // Same convention as the alert sheet's distance hint: the level relative
    // to the price it is being compared with.
    levels.push({ key, label, value, distancePercent: (value / current - 1) * 100 });
  };

  const window = window52Weeks(normalized);
  if (window && window.length > 0) {
    // The current session is part of the last 52 weeks, and the daily bars
    // behind these levels are fetched separately from the quote. Leaving the
    // session out would let the hero strip report a new high while this card
    // offered an alert at a level the price has already passed.
    push(
      "week52High",
      "52-week high",
      Math.max(current, sessionExtreme(options, "sessionHigh", current), ...window.map(highOf)),
    );
    push(
      "week52Low",
      "52-week low",
      Math.min(current, sessionExtreme(options, "sessionLow", current), ...window.map(lowOf)),
    );
  }
  push("sma20", "20-day average", movingAverage(normalized, 20));
  push("sma50", "50-day average", movingAverage(normalized, 50));
  return levels;
}

function joinPeriods(periods) {
  const list =
    periods.length === 1
      ? `${periods[0]}`
      : `${periods.slice(0, -1).join(", ")} and ${periods.at(-1)}`;
  return `${list} day average${periods.length > 1 ? "s" : ""}`;
}

function trendSentence(rows) {
  if (rows.length === 0) return null;
  const above = rows.filter((row) => row.state === "above").map((row) => row.period);
  const below = rows.filter((row) => row.state === "below").map((row) => row.period);
  if (below.length === 0) return `Price is above its ${joinPeriods(above)}.`;
  if (above.length === 0) return `Price is below its ${joinPeriods(below)}.`;
  return `Signals are mixed: price is above its ${joinPeriods(above)} and below its ${joinPeriods(
    below,
  )}.`;
}

/**
 * Price against its 20, 50 and 200 day averages, plus one summary sentence.
 * Deterministic: no model call, no invented level, no horizon the history
 * cannot support.
 *
 * @returns {{ rows: Array<{ key: string, label: string, period: number, average: number,
 *   state: "above" | "below", stateLabel: string, distancePercent: number }>,
 *   sentence: string | null }}
 */
export function deriveTrendSummary(bars, options = {}) {
  const normalized = normalizeBars(bars);
  if (!isDailySeries(normalized)) return { rows: [], sentence: null };
  const current = resolveCurrentPrice(normalized, options);
  if (!Number.isFinite(current) || current <= 0) return { rows: [], sentence: null };

  const rows = [];
  for (const period of TREND_PERIODS) {
    const average = movingAverage(normalized, period);
    if (!Number.isFinite(average) || average <= 0) continue;
    // A price exactly on its average is read as above it; the two states keep
    // the sentence readable and the case is vanishingly rare with real prices.
    const state = current >= average ? "above" : "below";
    rows.push({
      key: `sma${period}`,
      label: `${period}-day average`,
      period,
      average,
      state,
      stateLabel: state === "above" ? "Above" : "Below",
      distancePercent: (current / average - 1) * 100,
    });
  }
  return { rows, sentence: trendSentence(rows) };
}

/**
 * One assembled view model for the symbol page, derived from the daily history
 * and the quote the page already holds.
 */
export function buildSymbolViewModel({ bars, quote, historyStale, historyAsOf } = {}) {
  const normalized = normalizeBars(bars);
  const daily = isDailySeries(normalized);
  const quoteOk = quote?.status === "ok";
  const currentPrice = resolveCurrentPrice(normalized, {
    currentPrice: quoteOk ? quote.price : undefined,
  });
  const volume = deriveVolumeContext(normalized, {
    volume: quoteOk ? quote.volume : undefined,
  });
  // The page reads either the instrument quote or, for a saved symbol, the
  // market-state snapshot, and the snapshot names the session bounds
  // `dayHigh`/`dayLow`. Both shapes carry the same figures.
  const low = quoteOk ? (quote.low ?? quote.dayLow) : undefined;
  const high = quoteOk ? (quote.high ?? quote.dayHigh) : undefined;
  // The 52-week window reads the current session from the quote, because the
  // daily history behind it can still end at the previous one.
  const window52 = { currentPrice, sessionHigh: high, sessionLow: low };

  return {
    currentPrice: Number.isFinite(currentPrice) ? currentPrice : null,
    currency: quote?.currency ?? null,
    dayRange:
      Number.isFinite(low) && Number.isFinite(high) && high >= low && high > 0
        ? { low, high }
        : null,
    horizonReturns: deriveHorizonReturns(normalized, window52),
    keyLevels: deriveKeyLevels(normalized, window52),
    trend: deriveTrendSummary(normalized, { currentPrice }),
    volume,
    volumeLabel: formatVolumeContext(volume),
    hasDailyHistory: daily,
    // Everything above is derived from the fetched series, so the page has to
    // be able to say when that series is a retained copy served after the
    // provider stopped answering.
    historyStale: historyStale === true,
    historyAsOf: typeof historyAsOf === "string" && historyAsOf ? historyAsOf : null,
  };
}

/**
 * One line naming the freshness of the history every derived figure on the page
 * is calculated from, or null while that history is current.
 *
 * @returns {string | null}
 */
export function historyBasisNote(viewModel, nowMs = Date.now()) {
  if (!viewModel?.historyStale) return null;
  const label = shortDateLabel(viewModel.historyAsOf, nowMs);
  return label ? `Price history as of ${label}` : "Price history is not current";
}
