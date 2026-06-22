import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
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
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  validateSearch: validateGuiSearch,
});

const diagnosticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/diagnostics",
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

const predictionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/predictions",
  validateSearch: validateGuiSearch,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  sessionRoute,
  historyRoute,
  settingsRoute,
  diagnosticsRoute,
  watchlistsRoute,
  portfoliosRoute,
  alertsRoute,
  reportsRoute,
  predictionsRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

const VALID_DRAWERS = new Set(["history", "context", "catalog", "tools", "providers", "workflows"]);

function validateGuiSearch(search) {
  return {
    drawer:
      typeof search.drawer === "string" && VALID_DRAWERS.has(search.drawer)
        ? search.drawer
        : undefined,
    prompt: typeof search.prompt === "string" ? search.prompt : undefined,
  };
}
