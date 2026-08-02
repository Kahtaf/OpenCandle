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
      handler: "options.getSession().modelRuntime.refresh();",
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
    {
      route: 'url.pathname === "/api/market-state/indices"',
      handler: "await options.indicesSnapshotStore.get()",
      guard: 'allowTrustedGuiRequest(req, res, "Market-state API", options)',
    },
    {
      route: 'url.pathname === "/api/market-state/sparkline"',
      handler: "await fetchTickerLineSparkline(",
      guard: 'allowTrustedGuiRequest(req, res, "Market-state API", options)',
    },
    {
      route: 'url.pathname === "/api/instruments/history"',
      handler: "await getInstrumentHistorySnapshot(",
      guard: 'allowTrustedGuiRequest(req, res, "Market-state API", options)',
    },
    {
      route: 'url.pathname === "/api/instruments/overview"',
      handler: "await getInstrumentOverviewSnapshot(",
      guard: 'allowTrustedGuiRequest(req, res, "Market-state API", options)',
    },
  ])("requires trusted GUI requests before serving $route", ({ route, handler, guard }) => {
    const routeBlock = routeBlockBefore(route, handler);

    expect(routeBlock).toContain(guard);
  });

  it("returns 410 for the legacy active-session chat run route", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const routeStart = source.indexOf('url.pathname === "/api/chat/run"');
    const routeEnd = source.indexOf(
      'url.pathname === "/api/local-coordinator/chat-run"',
      routeStart,
    );
    const routeBlock = source.slice(routeStart, routeEnd);

    expect(routeBlock).toContain('allowTrustedGuiRequest(req, res, "Chat run API", options)');
    expect(routeBlock).toContain("writeJson(");
    expect(routeBlock).toContain("410");
    expect(routeBlock).not.toContain("handleSseChatRun");
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

  it("requires session-addressed chat runs to carry a client action id", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const routeStart = source.indexOf('sessionIdFromRoute(url.pathname, "runs")');
    const routeEnd = source.indexOf("serveStaticAsset", routeStart);
    const routeSource = source.slice(routeStart, routeEnd);

    expect(routeSource).toContain("requireSessionActionFields");
    expect(sessionActionFieldHelperSource()).toContain('"actionId is required"');
  });

  it("requires local coordinator authorization before accepting proxied chat runs", () => {
    const routeBlock = routeBlockBefore(
      'url.pathname === "/api/local-coordinator/chat-run"',
      "const body = asRecord(await readJsonBody(req));",
    );

    expect(routeBlock).toContain("allowLocalCoordinatorRequest(req, res, options)");
  });

  it("requires local coordinator chat runs to carry session and action ids", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const routeStart = source.indexOf('url.pathname === "/api/local-coordinator/chat-run"');
    const routeEnd = source.indexOf(
      'url.pathname === "/api/local-coordinator/tool-invoke"',
      routeStart,
    );
    const routeSource = source.slice(routeStart, routeEnd);

    expect(routeSource).toContain("requireSessionActionFields");
    expect(sessionActionFieldHelperSource()).toContain('"sessionId is required"');
    expect(sessionActionFieldHelperSource()).toContain('"actionId is required"');
  });

  it("requires local coordinator authorization before accepting proxied tool invokes", () => {
    const routeBlock = routeBlockBefore(
      'url.pathname === "/api/local-coordinator/tool-invoke"',
      "const body = asRecord(await readJsonBody(req));",
    );

    expect(routeBlock).toContain("allowLocalCoordinatorRequest(req, res, options)");
  });

  it("requires trusted GUI authorization before accepting HTTP fallback tool invokes", () => {
    const routeBlock = routeBlockBefore(
      'url.pathname === "/api/tool-invoke"',
      "const body = asRecord(await readJsonBody(req));",
    );

    expect(routeBlock).toContain('allowTrustedGuiRequest(req, res, "Tool invoke API", options)');
  });

  it("requires HTTP fallback tool invokes to carry session and action ids", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const routeStart = source.indexOf('url.pathname === "/api/tool-invoke"');
    const routeEnd = source.indexOf(
      'url.pathname === "/api/local-coordinator/tool-invoke"',
      routeStart,
    );
    const routeSource = source.slice(routeStart, routeEnd);

    expect(routeSource).toContain("requireSessionActionFields");
    expect(sessionActionFieldHelperSource()).toContain('"sessionId is required"');
    expect(sessionActionFieldHelperSource()).toContain('"actionId is required"');
  });

  it("requires proxied tool invokes to carry session and action ids", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const routeStart = source.indexOf('url.pathname === "/api/local-coordinator/tool-invoke"');
    const routeEnd = source.indexOf(
      'url.pathname === "/api/local-coordinator/ask-user"',
      routeStart,
    );
    const routeSource = source.slice(routeStart, routeEnd);

    expect(routeSource).toContain("requireSessionActionFields");
    expect(sessionActionFieldHelperSource()).toContain('"sessionId is required"');
    expect(sessionActionFieldHelperSource()).toContain('"actionId is required"');
  });

  it.each([
    [
      'url.pathname === "/api/tool-invoke"',
      'url.pathname === "/api/local-coordinator/tool-invoke"',
    ],
    [
      'url.pathname === "/api/local-coordinator/tool-invoke"',
      'url.pathname === "/api/local-coordinator/ask-user"',
    ],
  ])(
    "returns an error response when $route reports a failed tool invocation",
    (route, nextRoute) => {
      const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
      const routeStart = source.indexOf(route);
      const routeEnd = source.indexOf(nextRoute, routeStart + route.length);
      const routeSource = source.slice(routeStart, routeEnd);

      expect(routeSource).toContain("const result = asRecord(message.result);");
      expect(routeSource).toContain("if (message.ok === true && result.toolCallId)");
    },
  );

  it("requires local coordinator authorization before accepting proxied ask_user actions", () => {
    const routeBlock = routeBlockBefore(
      'url.pathname === "/api/local-coordinator/ask-user"',
      "const body = asRecord(await readJsonBody(req));",
    );

    expect(routeBlock).toContain("allowLocalCoordinatorRequest(req, res, options)");
  });

  it("requires proxied ask_user actions to carry session and action ids", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const routeStart = source.indexOf('url.pathname === "/api/local-coordinator/ask-user"');
    const routeEnd = source.indexOf('sessionIdFromRoute(url.pathname, "runs")', routeStart);
    const routeSource = source.slice(routeStart, routeEnd);

    expect(routeSource).toContain("requireSessionActionFields");
    expect(sessionActionFieldHelperSource()).toContain('"sessionId is required"');
    expect(sessionActionFieldHelperSource()).toContain('"actionId is required"');
  });

  it("keeps mutation routes from resolving the active session implicitly", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const legacyStart = source.indexOf('url.pathname === "/api/chat/run"');
    const legacyEnd = source.indexOf(
      'url.pathname === "/api/local-coordinator/chat-run"',
      legacyStart,
    );
    const legacyRoute = source.slice(legacyStart, legacyEnd);
    const coordinatorStart = source.indexOf('url.pathname === "/api/local-coordinator/chat-run"');
    const coordinatorEnd = source.indexOf("serveStaticAsset", coordinatorStart);
    const mutationRoutes = source.slice(coordinatorStart, coordinatorEnd);

    expect(legacyRoute).not.toContain("handleSseChatRun");
    expect(mutationRoutes).not.toContain("requestedSessionId ? await resolveSessionManagerById");
    expect(mutationRoutes).not.toContain("sessionId || safeSessionId");
    expect(mutationRoutes).not.toContain("sessionId || getSessionManager");
  });

  it("authorizes coordinator calls with the coordinator secret instead of browser cookies", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const guardStart = source.indexOf("function allowLocalCoordinatorRequest");
    const guardEnd = source.indexOf("function privateGuiHeaders", guardStart);
    const guardSource = source.slice(guardStart, guardEnd);

    expect(guardSource).toContain('req.headers["x-opencandle-coordinator-secret"]');
    expect(guardSource).not.toContain("isTrustedPrivateApiRequest");
    expect(guardSource).not.toContain("isLoopbackAddress");
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

  it("reuses the shared model runtime for saved GUI sessions", () => {
    const source = readFileSync(resolve("gui/server/server.ts"), "utf-8");
    const factoryStart = source.indexOf("createSessionForManager:");
    const factoryEnd = source.indexOf("wsHub,", factoryStart);
    const factorySource = source.slice(factoryStart, factoryEnd);

    expect(factorySource).toContain("modelRuntime,");
    expect(factorySource).not.toContain("authStorage,");
    expect(factorySource).not.toContain("modelRegistry,");
  });

  it("waits for a model refresh before broadcasting its result", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const routeStart = source.indexOf('url.pathname === "/api/model-setup/refresh"');
    const routeEnd = source.indexOf('url.pathname === "/api/model-setup/api-key"', routeStart);
    const routeSource = source.slice(routeStart, routeEnd);

    expect(routeSource).toContain(
      "await handleTrustedGuiMutation(req, res, options, async () => {",
    );
    expect(routeSource).toContain("await options.getSession().modelRuntime.refresh();");
    expect(routeSource.indexOf("await options.getSession().modelRuntime.refresh();")).toBeLessThan(
      routeSource.indexOf("options.wsHub.broadcastModelSetup();"),
    );
    expect(routeSource).not.toContain("writeJson(res,");
  });

  it("waits for WebSocket model refreshes before broadcasting their result", () => {
    const source = readFileSync(resolve("gui/server/ws-hub.ts"), "utf-8");
    const routeStart = source.indexOf('case "model.setup.refresh"');
    const routeEnd = source.indexOf('case "model.setup.save_api_key"', routeStart);
    const routeSource = source.slice(routeStart, routeEnd);

    expect(routeSource).toContain("await getSession().modelRuntime.refresh();");
    expect(routeSource.indexOf("await getSession().modelRuntime.refresh();")).toBeLessThan(
      routeSource.indexOf("broadcastModelSetup();"),
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
    const proxyBlock = source.slice(
      proxyStart,
      source.indexOf("if (options.localSessionCoordinator)", proxyStart),
    );

    expect(proxyBlock).toContain(
      "shouldBlockFailedCoordinatorAction(runSessionManager, bodyRecord)",
    );
    expect(proxyBlock).toContain('"OpenCandle is reconnecting to this session."');
    const lockSource = readFileSync(resolve("src/pi/session-writer-lock.ts"), "utf-8");
    expect(lockSource).toContain("return isCoordinatorOwnerAlive(lock.pid)");
  });

  it("keeps the model-setup gate on the session-addressed chat-run path", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const sseStart = source.indexOf("async function streamAcceptedSseChatRun");

    // The legacy controller handlePrompt carried this gate; after its
    // removal the SSE chat-run path is the only owner: a not-ready model
    // must record the user message plus an opencandle-model-setup entry
    // instead of prompting the model.
    const sseBlock = source.slice(sseStart);
    expect(sseBlock).toContain('modelSetup.requirement !== "ready"');
    expect(sseBlock).toContain('appendCustomMessageEntry("opencandle-model-setup"');
    const wsSource = readFileSync(resolve("gui/server/ws-hub.ts"), "utf-8");
    expect(wsSource).not.toContain("handlePrompt");
    expect(wsSource).toContain("Legacy active-session chat prompts are no longer supported");
  });

  it("persists slash-command input before the local GUI dispatches a workflow", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const sseStart = source.indexOf("async function streamAcceptedSseChatRun");
    const dispatchStart = source.indexOf("await promptAndSettle(", sseStart);
    const beforeDispatch = source.slice(sseStart, dispatchStart);

    expect(beforeDispatch).toContain(
      "if (shouldPersistOriginalInputMarker(prompt, inputAttachmentLabels))",
    );
  });

  it("keeps proxy forwarding reachable from the browser runs route but not the proxy target", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");

    // Regression guard: proxy allowance was once inferred from
    // `bodyOverride === undefined`, and when every caller began passing a
    // body the cross-process forwarding path went silently dead — browsers
    // got endless 409 "reconnecting" against sessions owned by another
    // process. The browser-facing runs route must allow proxying; the
    // local-coordinator endpoint (the proxy target) must not, or it loops.
    expect(source).not.toContain("bodyOverride === undefined");
    const runsRoute = source.slice(
      source.indexOf('sessionIdFromRoute(url.pathname, "runs")'),
      source.indexOf("serveStaticAsset(url.pathname, res, options)"),
    );
    expect(runsRoute).toContain(
      "handleSseChatRun(req, res, options, activeRunSessionIds, sessionManager, body, true)",
    );
    const coordinatorRoute = source.slice(
      source.indexOf('url.pathname === "/api/local-coordinator/chat-run"'),
      source.indexOf('url.pathname === "/api/local-coordinator/tool-invoke"'),
    );
    expect(coordinatorRoute).toContain(
      "handleSseChatRun(req, res, options, activeRunSessionIds, sessionManager, body, false)",
    );
  });

  it("records attachment metadata in chat action envelopes without image bytes", async () => {
    const { buildChatRunActionEnvelope } = await import("../../../gui/server/http-routes.js");

    expect(
      buildChatRunActionEnvelope(
        {
          prompt: "review this",
          actionId: "chat-1",
          images: [{ data: Buffer.from("image-bytes").toString("base64"), mimeType: "image/png" }],
          attachments: [{ kind: "portfolio" }],
        },
        "session-1",
      ),
    ).toEqual({
      sessionId: "session-1",
      actionId: "chat-1",
      actionType: "chat.prompt",
      payload: {
        prompt: "review this",
        imageCount: 1,
        attachments: [{ kind: "portfolio" }],
      },
      source: "browser",
    });
  }, 20_000);

  it("records image labels in user input metadata without image bytes", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");

    expect(source).toContain("inputAttachmentLabels");
    expect(source).toContain('kind: "image"');
    expect(source).toContain(
      "label: `" + "$" + '{image.mimeType || "image"} #' + "$" + "{index + 1}`",
    );
    expect(source).toContain("attachments: inputAttachmentLabels");
    expect(source).not.toContain("attachments: promptImages");
  });

  it("broadcasts target session snapshots after proxied chat runs", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const proxyStart = source.indexOf("if (shouldProxyChatRun)");
    const proxyBlock = source.slice(
      proxyStart,
      source.indexOf("if (actionId && hasAcceptedSessionAction", proxyStart),
    );

    expect(proxyBlock).toContain("await proxyChatRunToCoordinator");
    expect(proxyBlock).toContain(
      "await broadcastFreshRunSessionSnapshot(options, runSessionManager",
    );
    expect(source).toContain("SessionManager.open(sessionFile, options.sessionDir, options.cwd)");
  });

  it("forwards image and saved-context attachment fields through the chat-run proxy", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const proxyStart = source.indexOf("async function proxyChatRunToCoordinator");
    const proxyBlock = source.slice(
      proxyStart,
      source.indexOf("async function streamAcceptedSseChatRun", proxyStart),
    );

    expect(proxyBlock).toContain("body: JSON.stringify({ ...body, sessionId:");
    expect(proxyBlock).not.toContain("prompt:");
    expect(proxyBlock).not.toContain("actionId:");
  });

  it("syncs the current writer lock scope when a chat action is admitted", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const acceptedStart = source.indexOf("const recordAcceptedAction = () =>");
    const acceptedBlock = source.slice(acceptedStart, source.indexOf("};", acceptedStart) + 2);

    expect(acceptedBlock).toContain("recordAcceptedSessionAction(runSessionManager, actionId)");
    expect(acceptedBlock).toContain("options.syncCurrentWriterLockScope?.()");
  });

  it("does not mint legacy chat action ids on the server", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");

    expect(source).not.toContain("legacy-chat-");
  });

  it("refreshes GUI heartbeats against the migrated canonical session lock scope", () => {
    const source = readFileSync(resolve("gui/server/server.ts"), "utf-8");
    const syncStart = source.indexOf("function syncCurrentWriterLockScope");
    const heartbeatStart = source.indexOf("const heartbeat = setInterval", syncStart);
    const heartbeatBlock = source.slice(
      heartbeatStart,
      source.indexOf("const backgroundQuoteRefreshes", heartbeatStart),
    );
    const syncBlock = source.slice(syncStart, heartbeatStart);

    expect(syncBlock).toContain("migrateWriterLockScope");
    expect(syncBlock).toContain("currentWriterLockLost = true");
    expect(syncBlock).toContain("OpenCandle is reconnecting to this session.");
    expect(heartbeatBlock).toContain("syncCurrentWriterLockScope()");
    expect(heartbeatBlock).toContain("refreshWriterLock(activeWriterLockScope)");
    expect(heartbeatBlock).toContain("clearInterval(heartbeat)");
  });

  it("records chat actions as accepted when the user turn is admitted", () => {
    const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
    const handlerStart = source.indexOf("async function handleSseChatRun");
    const handlerEnd = source.indexOf("class SessionActionNotAdmitted", handlerStart);
    const handlerSource = source.slice(handlerStart, handlerEnd);
    const subscribeStart = handlerSource.indexOf("const unsubscribeLive = runSession.subscribe");
    const subscribeBlock = handlerSource.slice(
      subscribeStart,
      handlerSource.indexOf("});", subscribeStart) + 3,
    );

    expect(handlerSource).toContain("const recordAcceptedAction = () =>");
    expect(subscribeBlock).toContain("observation.userTexts.some");
    expect(subscribeBlock).toContain("recordAcceptedAction()");
  });

  it("publishes coordinator endpoints for the configured listener host", () => {
    const source = readFileSync(resolve("gui/server/server.ts"), "utf-8");
    const endpointLineStart = source.indexOf("const localCoordinatorEndpoint");
    const endpointLine = source.slice(endpointLineStart, source.indexOf("\n", endpointLineStart));
    const helperStart = source.indexOf("function coordinatorEndpointHost");
    const helperSource = source.slice(helperStart, source.indexOf("process.once", helperStart));

    expect(endpointLine).toContain("coordinatorEndpointHost(host)");
    expect(helperSource).toContain('bindHost === "0.0.0.0"');
    expect(helperSource).toContain('"127.0.0.1"');
    expect(helperSource).toContain('bindHost === "::"');
    expect(helperSource).toContain("[::1]");
  });

  it("uses neutral language when session rebind cannot acquire a writer lock", () => {
    const source = readFileSync(resolve("gui/server/server.ts"), "utf-8");
    const rebindStart = source.indexOf("runtime.setRebindSession");
    const rebindBlock = source.slice(
      rebindStart,
      source.indexOf("const interactiveMode", rebindStart),
    );

    expect(rebindBlock).toContain("OpenCandle is reconnecting to this session.");
    expect(rebindBlock).not.toContain("processKind");
    expect(rebindBlock).not.toContain("pid");
  });

  it("publishes coordinator metadata for non-current session tool locks", () => {
    const source = readFileSync(resolve("gui/server/invoke-tool.ts"), "utf-8");
    const acquireStart = source.indexOf('acquireWriterLock(lockScope, "gui"');
    const acquireBlock = source.slice(acquireStart, source.indexOf("});", acquireStart) + 3);

    expect(acquireBlock).toContain("coordinatorEndpoint: localCoordinatorEndpoint");
    expect(acquireBlock).toContain("coordinatorSecret: localCoordinatorSecret");
  });

  it("records tool actions as accepted once the tool transcript starts", () => {
    const source = readFileSync(resolve("gui/server/invoke-tool.ts"), "utf-8");
    const sharedSource = readFileSync(resolve("gui/shared/invoke-tool-from-ui.ts"), "utf-8");
    const invokeIndex = source.indexOf("result = await invokeTool");
    const transcriptIndex = sharedSource.indexOf("sessionManager.appendMessage(assistant);");
    const hookIndex = sharedSource.indexOf("options.onTranscriptStarted?.();", transcriptIndex);

    expect(invokeIndex).toBeGreaterThan(-1);
    expect(source.slice(invokeIndex, source.indexOf("});", invokeIndex))).toContain(
      "onTranscriptStarted: recordAcceptedAction",
    );
    expect(transcriptIndex).toBeGreaterThan(-1);
    expect(hookIndex).toBeGreaterThan(transcriptIndex);
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

function sessionActionFieldHelperSource(): string {
  const source = readFileSync(resolve("gui/server/http-routes.ts"), "utf-8");
  const helperStart = source.indexOf("function requireSessionActionFields");
  const helperEnd = source.indexOf("function shouldBlockFailedCoordinatorAction", helperStart);

  expect(helperStart).toBeGreaterThan(-1);
  expect(helperEnd).toBeGreaterThan(helperStart);

  return source.slice(helperStart, helperEnd);
}
