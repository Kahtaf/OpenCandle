const TICKER_SEGMENT = /^[A-Z0-9^.=-]+$/;
const SETTINGS_SEGMENT = /^\/settings(?:\/([^/]+))?\/?$/;

// Rail order. The first entry is what `/settings` and an unreadable section
// slug both resolve to.
export const SETTINGS_SECTIONS = [
  "model",
  "providers",
  "preferences",
  "automation",
  "diagnostics",
  "data",
];

export const DEFAULT_SETTINGS_SECTION = SETTINGS_SECTIONS[0];

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

export function symbolPageHref(ticker) {
  return `/symbol/${encodeURIComponent(String(ticker || "").toUpperCase())}`;
}

// Returns the settings section a path opens on, or "" when the path is not a
// settings path. `/diagnostics` is kept as an entry point into the Diagnostics
// section so old links and bookmarks keep landing on the same content.
export function settingsSectionFromPath(pathname) {
  if (pathname === "/diagnostics") return "diagnostics";

  const match = String(pathname || "").match(SETTINGS_SEGMENT);
  if (!match) return "";

  let slug = match[1] || "";
  try {
    slug = decodeURIComponent(slug);
  } catch {
    slug = "";
  }
  slug = slug.toLowerCase();
  return SETTINGS_SECTIONS.includes(slug) ? slug : DEFAULT_SETTINGS_SECTION;
}

export function settingsSectionHref(section) {
  const slug = SETTINGS_SECTIONS.includes(section) ? section : DEFAULT_SETTINGS_SECTION;
  return `/settings/${slug}`;
}

export function appPageFromPath(pathname) {
  const settingsSection = settingsSectionFromPath(pathname);
  if (settingsSection) return { page: "settings", section: settingsSection };

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
