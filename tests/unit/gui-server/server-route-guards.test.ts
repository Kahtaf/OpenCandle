import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("GUI server route guards", () => {
  it.each([
    {
      route: 'url.pathname === "/api/bootstrap"',
      handler: "writeJson(res, await options.wsHub.buildBootstrapPayload());",
      guard: 'allowTrustedGuiRequest(req, res, "Bootstrap API", options)',
    },
    {
      route: 'url.pathname === "/api/session/new"',
      handler: 'if (options.role !== "writer")',
      guard: 'allowTrustedGuiRequest(req, res, "Session API", options)',
    },
    {
      route: 'url.pathname === "/api/sessions"',
      handler: "writeJson(res, {",
      guard: 'allowTrustedGuiRequest(req, res, "Session API", options)',
    },
    {
      route: 'url.pathname === "/api/session/events"',
      handler: "writeJson(res, {",
      guard: 'allowTrustedGuiRequest(req, res, "Session API", options)',
    },
    {
      route: 'url.pathname === "/api/model-setup/refresh"',
      handler: "options.getSession().modelRegistry.refresh();",
      guard: 'allowTrustedGuiRequest(req, res, "Model setup API", options)',
    },
    {
      route: 'url.pathname === "/api/model-setup/api-key"',
      handler: "options.modelSetupController.handleSaveModelApiKey",
      guard: 'allowTrustedGuiRequest(req, res, "Model setup API", options)',
    },
    {
      route: 'url.pathname === "/api/model-setup/model"',
      handler: "options.modelSetupController.handleSelectModel",
      guard: 'allowTrustedGuiRequest(req, res, "Model setup API", options)',
    },
    {
      route: 'url.pathname === "/api/provider-setup/api-key"',
      handler: "options.modelSetupController.handleSaveProviderApiKey",
      guard: 'allowTrustedGuiRequest(req, res, "Provider setup API", options)',
    },
  ])("requires trusted GUI requests before serving $route", ({ route, handler, guard }) => {
    const routeBlock = routeBlockBefore(route, handler);

    expect(routeBlock).toContain(guard);
  });

  it("requires trusted GUI requests before starting chat runs", () => {
    const routeBlock = routeBlockBefore(
      'url.pathname === "/api/chat/run"',
      "await handleSseChatRun(req, res, options);",
    );

    expect(routeBlock).toContain('allowTrustedGuiRequest(req, res, "Chat run API", options)');
  });
});

function routeBlockBefore(route: string, handler: string): string {
  const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
  const routeStart = source.indexOf(route);
  const handlerStart = source.indexOf(handler, routeStart);

  expect(routeStart).toBeGreaterThan(-1);
  expect(handlerStart).toBeGreaterThan(routeStart);

  return source.slice(routeStart, handlerStart);
}
