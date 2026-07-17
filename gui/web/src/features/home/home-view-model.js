export function orderWatchlistMovers(watchlistQuotes = []) {
  return [...watchlistQuotes].sort((left, right) => {
    const leftChange = Number.isFinite(left?.changePercent) ? Math.abs(left.changePercent) : null;
    const rightChange = Number.isFinite(right?.changePercent)
      ? Math.abs(right.changePercent)
      : null;
    if (leftChange == null) return rightChange == null ? 0 : 1;
    if (rightChange == null) return -1;
    return rightChange - leftChange;
  });
}
