export function topCashtagMentions(
  texts: Iterable<string>,
  options: { exclude?: string; limit?: number } = {},
): string[] {
  const mentionCounts = new Map<string, number>();
  const tickerRegex = /\$([A-Z]{1,5})\b/g;

  for (const text of texts) {
    for (const match of text.matchAll(tickerRegex)) {
      const ticker = match[1];
      if (ticker === options.exclude) continue;
      mentionCounts.set(ticker, (mentionCounts.get(ticker) ?? 0) + 1);
    }
  }

  return [...mentionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, options.limit ?? 10)
    .map(([ticker]) => ticker);
}
