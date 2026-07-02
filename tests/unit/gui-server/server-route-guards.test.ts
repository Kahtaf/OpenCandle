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
    {
      route: 'url.pathname === "/api/doctor"',
      handler: "await buildDoctorReport({",
      guard: 'allowTrustedGuiRequest(req, res, "Diagnostics API", options)',
    },
  ])("requires trusted GUI requests before serving $route", ({ route, handler, guard }) => {
    const routeBlock = routeBlockBefore(route, handler);

    expect(routeBlock).toContain(guard);
  });

  it("requires trusted GUI requests before starting chat runs", () => {
    const routeBlock = routeBlockBefore(
      'url.pathname === "/api/chat/run"',
      "await handleSseChatRun(req, res, options, activeRunSessionIds);",
    );

    expect(routeBlock).toContain('allowTrustedGuiRequest(req, res, "Chat run API", options)');
  });

  it("requires trusted GUI requests before session-addressed bootstrap", () => {
    const routeBlock = routeBlockBefore(
      'sessionIdFromRoute(url.pathname, "bootstrap")',
      "const sessionManager = await resolveSessionManagerById(options, sessionBootstrapId);",
    );

    expect(routeBlock).toContain('allowTrustedGuiRequest(req, res, "Session API", options)');
  });

  it("requires trusted GUI requests before session-addressed chat runs", () => {
    const routeBlock = routeBlockBefore(
      'sessionIdFromRoute(url.pathname, "runs")',
      "const sessionManager = await resolveSessionManagerById(options, runSessionId);",
    );

    expect(routeBlock).toContain('allowTrustedGuiRequest(req, res, "Chat run API", options)');
  });

  it("requires local coordinator authorization before accepting proxied chat runs", () => {
    const routeBlock = routeBlockBefore(
      'url.pathname === "/api/local-coordinator/chat-run"',
      "const body = asRecord(await readJsonBody(req));",
    );

    expect(routeBlock).toContain("allowLocalCoordinatorRequest(req, res, options)");
  });

  it("requires local coordinator authorization before accepting proxied tool invokes", () => {
    const routeBlock = routeBlockBefore(
      'url.pathname === "/api/local-coordinator/tool-invoke"',
      "const body = asRecord(await readJsonBody(req));",
    );

    expect(routeBlock).toContain("allowLocalCoordinatorRequest(req, res, options)");
  });

  it("requires local coordinator authorization before accepting proxied ask_user actions", () => {
    const routeBlock = routeBlockBefore(
      'url.pathname === "/api/local-coordinator/ask-user"',
      "const body = asRecord(await readJsonBody(req));",
    );

    expect(routeBlock).toContain("allowLocalCoordinatorRequest(req, res, options)");
  });

  it("does not authorize local coordinator calls with browser cookies alone", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const guardStart = source.indexOf("function allowLocalCoordinatorRequest");
    const guardEnd = source.indexOf("function privateGuiHeaders", guardStart);
    const guardSource = source.slice(guardStart, guardEnd);

    expect(guardSource).toContain("isLoopbackAddress(req.socket.remoteAddress)");
    expect(guardSource).toContain('req.headers["x-opencandle-coordinator-secret"]');
    expect(guardSource).not.toContain("isTrustedPrivateApiRequest");
    expect(guardSource).not.toContain("cookie");
  });

  it("stamps route-created ask_user prompts with the target session id", () => {
    const source = readFileSync(resolve("gui/server/server.ts"), "utf-8");
    const factoryStart = source.indexOf("createSessionForManager:");
    const factoryEnd = source.indexOf("wsHub,", factoryStart);

    expect(factoryStart).toBeGreaterThan(-1);
    expect(factoryEnd).toBeGreaterThan(factoryStart);
    expect(source.slice(factoryStart, factoryEnd)).toContain(
      "askUserBridge.askForSession(targetSessionManager.getSessionId())",
    );
  });

  it("migrates current-session writer locks before broadcasting current run snapshots", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const broadcastStart = source.indexOf("function broadcastRunSessionSnapshot");
    const currentBranch = source.slice(broadcastStart, source.indexOf("} else {", broadcastStart));

    expect(currentBranch).toContain("options.syncCurrentWriterLockScope?.()");
  });

  it("admits chat runs by target session lock state instead of process startup role", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const handlerStart = source.indexOf("async function handleSseChatRun");
    const handlerEnd = source.indexOf("async function proxyChatRunToCoordinator", handlerStart);
    const handlerSource = source.slice(handlerStart, handlerEnd);

    expect(handlerSource).not.toContain('options.role !== "writer"');
  });

  it("blocks failed chat delivery only while the coordinator owner is still live", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const proxyStart = source.indexOf("const shouldProxyChatRun");
    const proxyBlock = source.slice(proxyStart, source.indexOf("if (options.localSessionCoordinator)", proxyStart));

    expect(proxyBlock).toContain("shouldBlockFailedCoordinatorAction(runSessionManager, bodyRecord)");
    expect(proxyBlock).toContain('"OpenCandle is reconnecting to this session."');
    expect(source).toContain("return isCoordinatorOwnerAlive(lock.pid)");
  });

  it("refreshes GUI heartbeats against the migrated canonical session lock scope", () => {
    const source = readFileSync(resolve("gui/server/server.ts"), "utf-8");
    const syncStart = source.indexOf("function syncCurrentWriterLockScope");
    const heartbeatStart = source.indexOf("const heartbeat = setInterval", syncStart);
    const heartbeatBlock = source.slice(
      heartbeatStart,
      source.indexOf("const backgroundQuoteRefreshes", heartbeatStart),
    );

    expect(source.slice(syncStart, heartbeatStart)).toContain("migrateWriterLockScope");
    expect(heartbeatBlock).toContain("syncCurrentWriterLockScope()");
    expect(heartbeatBlock).toContain("refreshWriterLock(activeWriterLockScope)");
  });

  it("publishes coordinator metadata for non-current session tool locks", () => {
    const source = readFileSync(resolve("gui/server/invoke-tool.ts"), "utf-8");
    const acquireStart = source.indexOf('acquireWriterLock(lockScope, "gui"');
    const acquireBlock = source.slice(acquireStart, source.indexOf("});", acquireStart) + 3);

    expect(acquireBlock).toContain("coordinatorEndpoint: localCoordinatorEndpoint");
    expect(acquireBlock).toContain("coordinatorSecret: localCoordinatorSecret");
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
