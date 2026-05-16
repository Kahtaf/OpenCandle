import { createRoute, createRootRoute, createRouter } from "@tanstack/react-router";
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

const routeTree = rootRoute.addChildren([indexRoute, sessionRoute, historyRoute, settingsRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

const VALID_DRAWERS = new Set(["history", "context", "catalog", "tools", "providers", "workflows"]);

function validateGuiSearch(search) {
  return {
    drawer: typeof search.drawer === "string" && VALID_DRAWERS.has(search.drawer) ? search.drawer : undefined,
    prompt: typeof search.prompt === "string" ? search.prompt : undefined,
  };
}
