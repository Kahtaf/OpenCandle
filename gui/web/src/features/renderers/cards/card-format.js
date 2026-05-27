export function extractDetails(message) {
  return message?.details?.value ?? message?.details ?? {};
}

export function formatLargeNumber(n) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

export function formatPrice(n, decimals) {
  if (!Number.isFinite(n)) return "—";
  const places = typeof decimals === "number" ? decimals : n < 1 ? 4 : 2;
  return `$${n.toFixed(places)}`;
}

export function formatPercent(n, decimals = 2) {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(decimals)}%`;
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateShort(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function relativeTime(value) {
  if (!value) return "—";
  const d = new Date(value).getTime();
  if (Number.isNaN(d)) return String(value);
  const diff = Date.now() - d;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return formatDate(value);
}

export function stripOpenCandleTags(text) {
  return String(text || "")
    .replace(/\[OPENCANDLE_[A-Z_]+[^\]]*\]\s*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
