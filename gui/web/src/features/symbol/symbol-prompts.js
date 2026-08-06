// Chip labels are written for the narrow detail rail, so they say what the chip
// does rather than repeating the ticker the page is already about. Each pair is
// [label, prompt]; the prompt is only ever placed in the chat box, never sent.
export function analyzePromptsForSymbol(ticker) {
  // Cashtag form so the composer and router treat the token as a ticker, not a word.
  const symbol = `$${ticker.trim().toUpperCase()}`;
  return [
    ["Deep research (takes a few minutes)", `/analyze ${symbol}`],
    ["Options chain", `Show options chain for ${symbol}`],
    // Deliberately unfinished: the reader names the other asset in the composer.
    ["Compare with another asset", `Compare ${symbol} with `],
    ["Alert me if it drops 10% in a week", `Alert me if ${symbol} drops 10% in a week`],
  ];
}
