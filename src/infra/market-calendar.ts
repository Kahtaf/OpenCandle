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

export const KNOWN_US_MARKET_HOLIDAYS: Record<string, string> = new Proxy(
  {} as Record<string, string>,
  {
    get(_target, property) {
      return typeof property === "string" ? marketHolidayName(property) : undefined;
    },
    has(_target, property) {
      return typeof property === "string" && marketHolidayName(property) !== undefined;
    },
  },
);

export function marketHolidayName(key: string): string | undefined {
  const date = dateFromKey(key);
  const year = date.getUTCFullYear();
  for (const candidateYear of [year - 1, year, year + 1]) {
    const holiday = marketHolidaysForYear(candidateYear).find((entry) => entry.date === key);
    if (holiday) return holiday.name;
  }
  return undefined;
}

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
    marketHolidayName(local.date) !== undefined,
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
  return day === 0 || day === 6 || marketHolidayName(key) !== undefined;
}

function marketHolidaysForYear(year: number): Array<{ date: string; name: string }> {
  return [
    observedFixedHoliday(year, 1, 1, "New Year's Day"),
    nthWeekdayHoliday(year, 1, 1, 3, "Martin Luther King Jr. Day"),
    nthWeekdayHoliday(year, 2, 1, 3, "Washington's Birthday"),
    { date: dateKey(addDays(easterDate(year), -2)), name: "Good Friday" },
    lastWeekdayHoliday(year, 5, 1, "Memorial Day"),
    observedFixedHoliday(year, 6, 19, "Juneteenth"),
    observedFixedHoliday(year, 7, 4, "Independence Day"),
    nthWeekdayHoliday(year, 9, 1, 1, "Labor Day"),
    nthWeekdayHoliday(year, 11, 4, 4, "Thanksgiving Day"),
    observedFixedHoliday(year, 12, 25, "Christmas Day"),
  ];
}

function observedFixedHoliday(
  year: number,
  month: number,
  day: number,
  name: string,
): {
  date: string;
  name: string;
} {
  const actual = new Date(Date.UTC(year, month - 1, day));
  const weekday = actual.getUTCDay();
  const observed =
    weekday === 0 ? addDays(actual, 1) : weekday === 6 ? addDays(actual, -1) : actual;
  return {
    date: dateKey(observed),
    name: observed.getTime() === actual.getTime() ? name : `${name} observed`,
  };
}

function nthWeekdayHoliday(
  year: number,
  month: number,
  weekday: number,
  occurrence: number,
  name: string,
): { date: string; name: string } {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return { date: dateKey(addDays(first, offset + (occurrence - 1) * 7)), name };
}

function lastWeekdayHoliday(
  year: number,
  month: number,
  weekday: number,
  name: string,
): { date: string; name: string } {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return { date: dateKey(addDays(last, -offset)), name };
}

function easterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easterMonth = Math.floor((h + l - 7 * m + 114) / 31);
  const easterDay = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, easterMonth - 1, easterDay));
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
