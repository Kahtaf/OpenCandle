const TICKER_SEGMENT = /^[A-Z0-9^.-]+$/;

export function tickerFromPath(pathname) {
  const match = pathname.match(/^\/symbol\/([^/]+)$/);
  if (!match) return "";

  try {
    const ticker = decodeURIComponent(match[1]).toUpperCase();
    return TICKER_SEGMENT.test(ticker) ? ticker : "";
  } catch {
    return "";
  }
}

export function appPageFromPath(pathname) {
  if (pathname === "/diagnostics") return { page: "diagnostics" };

  const ticker = tickerFromPath(pathname);
  if (ticker) return { page: "symbol", ticker };

  const domain = domainFromPath(pathname);
  if (domain) return { page: "market-state", domain };

  return { page: "chat" };
}

export function domainFromPath(pathname) {
  if (pathname === "/watchlists") return "watchlists";
  if (pathname === "/portfolios") return "portfolios";
  if (pathname === "/alerts") return "alerts";
  if (pathname === "/reports") return "reports";
  return "";
}
