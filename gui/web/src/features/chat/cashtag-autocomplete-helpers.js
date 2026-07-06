export function detectCashtagFragment(text, caretIndex) {
  const value = String(text ?? "");
  const index = Math.max(0, Math.min(Number(caretIndex) || 0, value.length));
  const prefix = value.slice(0, index);
  const match = prefix.match(/(^|[^A-Za-z0-9_])\$([A-Za-z]{1,6})$/);
  if (!match) return null;
  const fragment = match[2];
  const start = index - fragment.length - 1;
  return { fragment, start, end: index };
}

export function insertAcceptedCashtag(text, match, symbol) {
  const value = String(text ?? "");
  const replacement = `$${String(symbol ?? "")
    .trim()
    .toUpperCase()} `;
  const start = Math.max(0, match.start);
  const end = Math.max(start, match.end);
  return {
    text: `${value.slice(0, start)}${replacement}${value.slice(end)}`,
    caretIndex: start + replacement.length,
  };
}
