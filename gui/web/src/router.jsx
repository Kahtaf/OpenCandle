import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { AppShell } from "./App.jsx";

const rootRoute = createRootRoute({
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: validateGuiSearch,
});

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions/$sessionId",
  validateSearch: validateGuiSearch,
});

const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/history",
  validateSearch: validateGuiSearch,
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  validateSearch: validateGuiSearch,
});

const settingsSectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$section",
  validateSearch: validateGuiSearch,
});

const diagnosticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/diagnostics",
  validateSearch: validateGuiSearch,
});

const symbolRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/symbol/$ticker",
  validateSearch: validateGuiSearch,
});

const watchlistsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/watchlists",
  validateSearch: validateGuiSearch,
});

const portfoliosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/portfolios",
  validateSearch: validateGuiSearch,
});

const alertsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/alerts",
  validateSearch: validateGuiSearch,
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports",
  validateSearch: validateGuiSearch,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  sessionRoute,
  historyRoute,
  settingsRoute,
  settingsSectionRoute,
  diagnosticsRoute,
  symbolRoute,
  watchlistsRoute,
  portfoliosRoute,
  alertsRoute,
  reportsRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

const VALID_DRAWERS = new Set(["history", "catalog", "tools", "providers", "workflows"]);

function validateGuiSearch(search) {
  return {
    drawer:
      typeof search.drawer === "string" && VALID_DRAWERS.has(search.drawer)
        ? search.drawer
        : undefined,
    provider: typeof search.provider === "string" ? search.provider : undefined,
    prompt: typeof search.prompt === "string" ? search.prompt : undefined,
    messageId: typeof search.messageId === "string" ? search.messageId : undefined,
    researchId: typeof search.researchId === "string" ? search.researchId : undefined,
    synthesisId: typeof search.synthesisId === "string" ? search.synthesisId : undefined,
    alertSymbol: typeof search.alertSymbol === "string" ? search.alertSymbol : undefined,
    // The router's search parser reads a bare number out of the query string,
    // so a price level arrives typed rather than as text. Both forms are kept
    // as text here; the alerts page decides whether the level is one it could
    // save.
    alertThreshold:
      typeof search.alertThreshold === "string" || typeof search.alertThreshold === "number"
        ? String(search.alertThreshold)
        : undefined,
  };
}
