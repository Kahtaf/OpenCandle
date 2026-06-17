import { extractEntities } from "../../routing/entity-extractor.js";
import type { SentinelRecord } from "../../sentiment/types.js";

const STOP_TERMS = new Set([
  "about",
  "around",
  "are",
  "from",
  "how",
  "is",
  "latest",
  "mood",
  "now",
  "on",
  "or",
  "people",
  "reddit",
  "retail",
  "right",
  "say",
  "saying",
  "says",
  "sentiment",
  "social",
  "stock",
  "stocks",
  "talking",
  "the",
  "think",
  "thinking",
  "to",
  "tweet",
  "tweets",
  "twitter",
  "what",
  "with",
]);

export function sentimentQueryTerms(query: string): string[] {
  const hasSp500 = /\bs\s*&\s*p\s*500\b/i.test(query) || /\bspx\b/i.test(query);

  const symbols = hasSp500
    ? ["sp500"]
    : extractEntities(query).symbols.map((symbol) => symbol.toLowerCase());
  const punctuationTerms = [...query.toLowerCase().matchAll(/\b([a-z])\s*[&/]\s*([a-z])\b/g)].map(
    (match) => `${match[1]}${match[2]}`,
  );
  const terms = query.toLowerCase().match(/[a-z0-9]{2,}/g);
  if (!terms) {
    if (punctuationTerms.length > 0) return [...new Set(punctuationTerms)];
    const compact = query.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (compact.length >= 2) return [compact];
    return query.trim().length > 0 ? [query.trim().toLowerCase()] : [];
  }

  const stopTerms = hasSp500 ? new Set([...STOP_TERMS, "sp", "spx", "500"]) : STOP_TERMS;
  const filtered = [
    ...new Set([...punctuationTerms, ...terms.filter((term) => !stopTerms.has(term))]),
  ].slice(0, 6);
  if (symbols.length > 0) {
    return [
      ...new Set([
        ...symbols,
        ...filtered.filter((term) => !symbols.some((symbol) => symbol.startsWith(term))),
      ]),
    ].slice(0, 6);
  }
  if (filtered.length > 0) return filtered;
  return query.trim().length > 0 ? [query.trim().toLowerCase()] : [];
}

export function recordMatchesSentimentQuery(
  record: SentinelRecord,
  terms: readonly string[],
): boolean {
  if (terms.length === 0) return true;
  const text = `${record.title ?? ""}\n${record.text}`.toLowerCase();
  const textTokens = new Set(text.match(/[a-z0-9]+/g) ?? []);
  const metadataTokens = new Set<string>();
  const subreddit = record.metadata.subreddit;
  if (typeof subreddit === "string") {
    metadataTokens.add(subreddit.toLowerCase());
    metadataTokens.add(subreddit.toLowerCase().replace(/^r\//, ""));
  }
  if (/\bs\s*&\s*p\s*500\b/i.test(text) || /\bspx\b/i.test(text)) textTokens.add("sp500");
  for (const match of text.matchAll(/\b([a-z])\s*[&/]\s*([a-z])\b/g)) {
    textTokens.add(`${match[1]}${match[2]}`);
  }
  for (const match of text.matchAll(/\b([a-z]{1,5})[.-]([a-z])\b/g)) {
    textTokens.add(`${match[1]}${match[2]}`);
  }
  const tickerTokens = new Set<string>();
  for (const ticker of record.sentiment.tickers) {
    const normalized = ticker.toLowerCase();
    tickerTokens.add(normalized);
    tickerTokens.add(normalized.replace(/[^a-z0-9]/g, ""));
  }
  const matchedTerms = terms.filter(
    (term) => tickerTokens.has(term) || textTokens.has(term) || metadataTokens.has(term),
  );
  for (const term of terms) {
    if (matchedTerms.includes(term) || !term.includes(" ")) continue;
    if (text.includes(term)) matchedTerms.push(term);
  }
  for (const term of terms) {
    if (matchedTerms.includes(term) || term.length < 4) continue;
    if (textTokens.has(`${term}s`)) {
      matchedTerms.push(term);
      continue;
    }
    if (term.endsWith("s") && textTokens.has(term.slice(0, -1))) {
      matchedTerms.push(term);
    }
  }
  const requiredMatches = terms.length > 1 ? 2 : 1;
  return matchedTerms.length >= requiredMatches;
}
