export type MarketSession =
  | "closed_weekend"
  | "closed_holiday"
  | "pre_market"
  | "open"
  | "after_close"
  | "closed_after_hours"
  | "unknown";

export interface LocalDateTimeParts {
  date: string;
  time: string;
  weekday: string;
  minutesSinceMidnight: number;
}

export const KNOWN_US_MARKET_HOLIDAYS: Record<string, string> = {
  "2026-01-01": "New Year's Day",
  "2026-01-19": "Martin Luther King Jr. Day",
  "2026-02-16": "Washington's Birthday",
  "2026-04-03": "Good Friday",
  "2026-05-25": "Memorial Day",
  "2026-06-19": "Juneteenth",
  "2026-07-03": "Independence Day observed",
  "2026-09-07": "Labor Day",
  "2026-11-26": "Thanksgiving Day",
  "2026-12-25": "Christmas Day",
};

export function classifyMarketStatus(
  local: LocalDateTimeParts,
  isWeekend: boolean,
  isMarketHoliday: boolean,
  temporalReferences: string[],
): Exclude<MarketSession, "unknown"> {
  if (isWeekend) return "closed_weekend";
  if (isMarketHoliday) return "closed_holiday";
  if (local.minutesSinceMidnight < 9 * 60 + 30) return "pre_market";
  if (local.minutesSinceMidnight < 16 * 60) return "open";
  if (temporalReferences.includes("after_close")) return "after_close";
  return "closed_after_hours";
}

export function classifyMarketStatusAt(now: Date): MarketSession {
  const local = localDateTimeParts(now, "America/New_York");
  return classifyMarketStatus(
    local,
    local.weekday === "Sat" || local.weekday === "Sun",
    KNOWN_US_MARKET_HOLIDAYS[local.date] !== undefined,
    [],
  );
}

export function localDateTimeParts(date: Date, timezone: string): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = formatter.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: parts.weekday ?? "",
    minutesSinceMidnight: hour * 60 + minute,
  };
}

export function lastTradingDay(localDate: string): string {
  let cursor = dateFromKey(localDate);
  do {
    cursor = addDays(cursor, -1);
  } while (isWeekendOrKnownHoliday(dateKey(cursor)));
  return dateKey(cursor);
}

export function isWeekendOrKnownHoliday(key: string): boolean {
  const date = dateFromKey(key);
  const day = date.getUTCDay();
  return day === 0 || day === 6 || KNOWN_US_MARKET_HOLIDAYS[key] !== undefined;
}

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
