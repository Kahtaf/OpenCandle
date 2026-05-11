export type GuiPromptIntent =
  | { type: "agent" }
  | { type: "stock_quote"; symbol: string }
  | { type: "stock_quote_compare"; symbols: string[] }
  | { type: "tool_prompt"; toolName: string; args: Record<string, unknown> };

const SYMBOL = /\b[A-Z][A-Z0-9. -]{0,8}\b/;

export function parseGuiPromptIntent(prompt: string): GuiPromptIntent {
  const normalized = prompt.trim();
  const lower = normalized.toLowerCase();
  const symbols = findLikelySymbols(normalized);
  const symbol = findSymbolAfter(normalized, /\b(?:for|of|on)\s+/i) ?? symbols[0] ?? "NVDA";

  if (/\b(options?|chain)\b/.test(lower) && symbols.length > 0) {
    return { type: "tool_prompt", toolName: "get_option_chain", args: { symbol } };
  }
  if (/\b(history|historical|chart|prices?)\b/.test(lower) && /\b(stock|share|chart|history|historical)\b/.test(lower) && symbols.length > 0 && !/\bcompare\b/.test(lower)) {
    return { type: "tool_prompt", toolName: "get_stock_history", args: { symbol, range: "1mo", interval: "1d" } };
  }
  if (/\b(sec|filings?|10-k|10-q|8-k)\b/.test(lower) && symbols.length > 0) {
    return { type: "tool_prompt", toolName: "get_sec_filings", args: { symbol, limit: 5 } };
  }
  if (/\b(fundamentals?|overview|company overview)\b/.test(lower) && symbols.length > 0) {
    return { type: "tool_prompt", toolName: "get_company_overview", args: { symbol } };
  }
  if (/\b(fred|cpi|inflation|macro|economic)\b/.test(lower)) {
    const series = /\bcpi|inflation\b/.test(lower) ? "CPIAUCSL" : "GDP";
    return { type: "tool_prompt", toolName: "get_economic_data", args: { series_id: series, limit: 12 } };
  }
  if (/\b(news|web search|headlines)\b/.test(lower)) {
    return { type: "tool_prompt", toolName: "search_web", args: { query: `${symbol} financial news`, category: "news", freshness: "day", limit: 5 } };
  }
  if (/\b(watchlist)\b/.test(lower)) {
    return { type: "tool_prompt", toolName: "manage_watchlist", args: { action: "add", symbol } };
  }

  if (/\bcompare\b/.test(lower) && /\b(quotes?|prices?)\b/.test(lower) && symbols.length >= 2) {
    return { type: "stock_quote_compare", symbols: symbols.slice(0, 4) };
  }

  if (!/\b(quotes?|prices?)\b/.test(lower) || /\b(compare|analy[sz]e|analysis|why|should|buy|sell)\b/.test(lower)) {
    return { type: "agent" };
  }

  return symbol ? { type: "stock_quote", symbol } : { type: "agent" };
}

function findSymbolAfter(prompt: string, prefix: RegExp): string | undefined {
  const start = prompt.search(prefix);
  if (start < 0) return undefined;
  const match = prompt.slice(start).match(SYMBOL);
  return normalizeSymbol(match?.[0]);
}

function findLikelySymbols(prompt: string): string[] {
  const matches = prompt.match(new RegExp(SYMBOL.source, "g")) ?? [];
  return [...new Set(matches.map(normalizeSymbol).filter((symbol): symbol is string => Boolean(symbol)))];
}

function normalizeSymbol(value: string | undefined): string | undefined {
  const symbol = value?.replace(/[^A-Z0-9.-]/g, "").replace(/[.-]+$/g, "").toUpperCase();
  if (!symbol || ["GET", "SHOW", "LATEST", "QUOTE", "PRICE", "THE", "FOR"].includes(symbol)) return undefined;
  return symbol;
}
