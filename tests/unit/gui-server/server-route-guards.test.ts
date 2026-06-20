import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("GUI server route guards", () => {
  it.each([
    {
      route: 'url.pathname === "/api/bootstrap"',
      handler: "writeJson(res, await wsHub.buildBootstrapPayload());",
      guard: 'allowTrustedGuiRequest(req, res, "Bootstrap API")',
    },
    {
      route: 'url.pathname === "/api/session/new"',
      handler: 'if (lockResult.role !== "writer")',
      guard: 'allowTrustedGuiRequest(req, res, "Session API")',
    },
    {
      route: 'url.pathname === "/api/sessions"',
      handler: "writeJson(res, {",
      guard: 'allowTrustedGuiRequest(req, res, "Session API")',
    },
    {
      route: 'url.pathname === "/api/session/events"',
      handler: "writeJson(res, {",
      guard: 'allowTrustedGuiRequest(req, res, "Session API")',
    },
    {
      route: 'url.pathname === "/api/model-setup/refresh"',
      handler: "session.modelRegistry.refresh();",
      guard: 'allowTrustedGuiRequest(req, res, "Model setup API")',
    },
    {
      route: 'url.pathname === "/api/model-setup/api-key"',
      handler: "modelSetupController.handleSaveModelApiKey",
      guard: 'allowTrustedGuiRequest(req, res, "Model setup API")',
    },
    {
      route: 'url.pathname === "/api/model-setup/model"',
      handler: "modelSetupController.handleSelectModel",
      guard: 'allowTrustedGuiRequest(req, res, "Model setup API")',
    },
    {
      route: 'url.pathname === "/api/provider-setup/api-key"',
      handler: "modelSetupController.handleSaveProviderApiKey",
      guard: 'allowTrustedGuiRequest(req, res, "Provider setup API")',
    },
  ])("requires trusted GUI requests before serving $route", ({ route, handler, guard }) => {
    const routeBlock = routeBlockBefore(route, handler);

    expect(routeBlock).toContain(guard);
  });

  it("requires trusted GUI requests before starting chat runs", () => {
    const routeBlock = routeBlockBefore(
      'url.pathname === "/api/chat/run"',
      "await handleSseChatRun(req, res);",
    );

    expect(routeBlock).toContain('allowTrustedGuiRequest(req, res, "Chat run API")');
  });
});

function routeBlockBefore(route: string, handler: string): string {
  const source = readFileSync(resolve("gui/server/server.ts"), "utf-8");
  const routeStart = source.indexOf(route);
  const handlerStart = source.indexOf(handler, routeStart);

  expect(routeStart).toBeGreaterThan(-1);
  expect(handlerStart).toBeGreaterThan(routeStart);

  return source.slice(routeStart, handlerStart);
}
