export function normalizeWatchlistOptions(watchlists) {
  const options = [];
  for (const watchlist of watchlists ?? []) {
    const name = String(watchlist?.name ?? "").trim();
    if (!name) continue;
    options.push({
      id: watchlist?.id == null ? "default" : String(watchlist.id),
      name,
    });
  }
  return options.length > 0 ? options : [{ id: "default", name: "Default" }];
}

export function watchlistAttachmentForOption(watchlist) {
  const option = watchlist ?? { id: "default", name: "Default" };
  return {
    kind: "watchlist",
    id: String(option.id ?? "default"),
    label: `Watchlist: ${option.name || "Default"}`,
  };
}

export function normalizePortfolioOptions(portfolios) {
  const options = [];
  for (const portfolio of portfolios ?? []) {
    const name = String(portfolio?.name ?? "").trim();
    if (!name) continue;
    options.push({
      id: portfolio?.id == null ? "default" : String(portfolio.id),
      name,
    });
  }
  return options.length > 0 ? options : [{ id: "default", name: "Default" }];
}

export function portfolioAttachmentForOption(portfolio) {
  const option = portfolio ?? { id: "default", name: "Default" };
  return {
    kind: "portfolio",
    id: String(option.id ?? "default"),
    label: `Portfolio: ${option.name || "Default"}`,
  };
}
