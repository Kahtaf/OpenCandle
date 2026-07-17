const DASH = "—";
const MINUS = "−";
const formatterCache = new Map();

function getFormatter(options) {
  const key = JSON.stringify(options);
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizedCurrency(currency) {
  const code = String(currency || "USD")
    .trim()
    .toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "USD";
}

function normalizeSpacing(value) {
  return value.replaceAll("\u00a0", " ");
}

function signFor(value) {
  return value > 0 ? "+" : value < 0 ? MINUS : "";
}

export function formatMoney(value, currency = "USD") {
  if (!isFiniteNumber(value)) return DASH;
  const code = normalizedCurrency(currency);
  return normalizeSpacing(
    getFormatter({
      style: "currency",
      currency: code,
      currencyDisplay: code === "USD" ? "narrowSymbol" : "code",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value),
  );
}

export function formatPrice(value, currency) {
  if (!isFiniteNumber(value)) return DASH;
  return currency
    ? formatMoney(value, currency)
    : formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatCompactMoney(value, currency = "USD") {
  if (!isFiniteNumber(value)) return DASH;
  const code = normalizedCurrency(currency);
  return normalizeSpacing(
    getFormatter({
      style: "currency",
      currency: code,
      currencyDisplay: code === "USD" ? "narrowSymbol" : "code",
      notation: "compact",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value),
  );
}

export function formatNumber(value, options = {}) {
  if (!isFiniteNumber(value)) return DASH;
  return getFormatter({
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  }).format(value);
}

export function formatQuantity(value) {
  return formatNumber(value, { maximumFractionDigits: 8 });
}

export function formatCompactNumber(value) {
  if (!isFiniteNumber(value)) return DASH;
  return getFormatter({ notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatPercent(value, options = {}) {
  if (!isFiniteNumber(value)) return DASH;
  const decimals = options.decimals ?? 2;
  const numericValue = options.ratio ? value * 100 : value;
  const sign = options.signed ? signFor(numericValue) : "";
  return `${sign}${formatNumber(Math.abs(numericValue), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}%`;
}

export function formatSignedMoney(value, currency = "USD") {
  if (!isFiniteNumber(value)) return DASH;
  return `${signFor(value)}${formatMoney(Math.abs(value), currency)}`;
}

export function formatSignedMoneyChange(value, percent, currency = "USD") {
  if (!isFiniteNumber(value) || !isFiniteNumber(percent)) return DASH;
  return `${formatSignedMoney(value, currency)} (${formatPercent(percent, {
    decimals: 1,
    signed: true,
  })})`;
}

export function formatChartPrice(value) {
  if (!isFiniteNumber(value)) return DASH;
  const decimals = Math.abs(value) >= 1000 ? 0 : 2;
  return formatNumber(value, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
