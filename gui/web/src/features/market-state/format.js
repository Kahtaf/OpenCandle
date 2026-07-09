const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function relativeTime(iso, nowMs = Date.now()) {
  const ts = Date.parse(iso ?? "");
  if (!Number.isFinite(ts)) return "";
  const deltaMs = nowMs - ts;
  if (deltaMs < 60_000) return "just now";
  if (deltaMs < 60 * 60_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  if (deltaMs < 24 * 60 * 60_000) return `${Math.floor(deltaMs / (60 * 60_000))}h ago`;
  const date = new Date(ts);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

export function shortDateLabel(iso, nowMs = Date.now()) {
  const ts = Date.parse(iso ?? "");
  if (!Number.isFinite(ts)) return "";
  const date = new Date(ts);
  const label = `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
  return date.getUTCFullYear() === new Date(nowMs).getUTCFullYear()
    ? label
    : `${label}, ${date.getUTCFullYear()}`;
}
