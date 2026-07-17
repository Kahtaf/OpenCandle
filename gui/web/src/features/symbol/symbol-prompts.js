export function analyzePromptsForSymbol(ticker) {
  const symbol = ticker.trim().toUpperCase();
  return [
    [`What is ${symbol} trading at?`, `What is ${symbol} trading at?`],
    [`Options chain for ${symbol}`, `Show options chain for ${symbol}`],
    [`Deep research: ${symbol} (multi-analyst, takes a few minutes)`, `/analyze ${symbol}`],
  ];
}
