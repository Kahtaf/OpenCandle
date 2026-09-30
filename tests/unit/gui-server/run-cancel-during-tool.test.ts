/**
 * HTTP integration proof that Stop during a tool call renders as Stopped.
 *
 * Defect: Stop while a tool executes lets the tool finish, and the next model
 * request then fails with an abort-shaped error persisted as
 * `stopReason: "error"`. With no durable record of the user's Stop, the
 * transcript (live snapshot and reload) rendered "Model connection failed".
 * The run must record a stop marker naming that entry before it broadcasts
 * the session snapshot, so the adapter renders the turn as Stopped.
 *
 * Boundary: a real ephemeral `node:http` server around the real
 * `createHttpRequestHandler`. The fake session's prompt() stands in for the
 * agent loop: a tool call that finishes after the Stop, then a model request
 * rejected with "This operation was aborted".
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession, SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sessionEntriesToChatEvents } from "../../../gui/server/chat-event-adapter.js";
import { createHttpRequestHandler } from "../../../gui/server/http-routes.js";
import type { ToolInvokeController } from "../../../gui/server/invoke-tool.js";
import type { ModelSetupController } from "../../../gui/server/model-setup.js";
import { privateApiCookieHeader } from "../../../gui/server/private-api-access.js";
import type { QuoteSnapshotStore } from "../../../gui/server/quote-snapshot-store.js";
import { createGuiRunRegistry } from "../../../gui/server/run-cancellation.js";
import type { SessionActionsController } from "../../../gui/server/session-actions.js";
import type { WsHub } from "../../../gui/server/ws-hub.js";

const privateApiSessionToken = "run-cancel-during-tool-token";
const trustedHeaders = { cookie: privateApiCookieHeader(privateApiSessionToken) };
const sessionId = "session-stop-during-tool";

describe("chat-run Stop while a tool call is executing", () => {
  let server: Server;
  let endpoint: string;
  let tempRoot: string;
  let sessionDir: string;
  let previousHome: string | undefined;
  const entries: SessionEntry[] = [];
  const runRegistry = createGuiRunRegistry();
  let toolStarted: () => void = () => {};
  let finishTool: () => void = () => {};
  const snapshotsAtBroadcast: SessionEntry[][] = [];

  const model = { provider: "test-provider", id: "test-model" };
  const modelRuntime = {
    refresh: () => undefined,
    getError: () => undefined,
    getModels: () => [model],
    getAvailableSnapshot: () => [model],
    getModel: () => undefined,
    hasConfiguredAuth: () => true,
  };

  function currentSessionManager(): SessionManager {
    return {
      getSessionId: () => sessionId,
      getSessionFile: () => join(sessionDir, `${sessionId}.jsonl`),
      getSessionDir: () => sessionDir,
      getEntries: () => entries,
      getSessionName: () => "Stop during tool session",
      isPersisted: () => false,
      appendMessage: () => {},
      appendCustomEntry: (customType: string, data: unknown) => {
        entries.push({
          id: `entry-${entries.length}`,
          type: "custom",
          customType,
          data,
          timestamp: new Date().toISOString(),
        } as unknown as SessionEntry);
      },
      appendCustomMessageEntry: () => {},
      appendSessionInfo: () => {},
    } as unknown as SessionManager;
  }

  // Stop while a tool runs: the tool finishes, then the follow-up model
  // request is rejected with an abort-shaped error.
  const toolRunningScenario = async (text: string) => {
    push({ role: "user", content: text, timestamp: Date.now() });
    push({
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "get_stock_quote", arguments: {} }],
      stopReason: "toolUse",
    });
    const toolDone = new Promise<void>((resolve) => {
      finishTool = resolve;
    });
    toolStarted();
    await toolDone;
    push({
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "get_stock_quote",
      content: [{ type: "text", text: "AAPL: $189.42" }],
      isError: false,
      timestamp: Date.now(),
    });
    // The model request after the tool is rejected by an abort the provider
    // adapter does not attribute to its own signal.
    push({
      role: "assistant",
      content: [],
      stopReason: "error",
      errorMessage: "This operation was aborted",
    });
  };

  // Stop during step 2 of a multi-step workflow, while the model is still
  // streaming that step's tool call: the partial reply keeps the cut-off tool
  // call and ends in an abort-shaped error. Pi never runs that tool call, so
  // no tool result will ever follow it.
  let stepTwoStreaming: () => void = () => {};
  let abortStream: () => void = () => {};
  const workflowStepTwoScenario = async (text: string) => {
    push({ role: "user", content: text, timestamp: Date.now() });
    push({
      role: "assistant",
      content: [{ type: "text", text: "Step 1: market data gathered." }],
      stopReason: "stop",
    });
    push({ role: "user", content: "Step 2: fundamentals analyst", timestamp: Date.now() });
    const aborted = new Promise<void>((resolve) => {
      abortStream = resolve;
    });
    stepTwoStreaming();
    await aborted;
    push({
      role: "assistant",
      content: [{ type: "toolCall", id: "call-cut", name: "get_financials", arguments: {} }],
      stopReason: "error",
      errorMessage: "This operation was aborted",
    });
  };
  let scenario: (text: string) => Promise<void> = toolRunningScenario;

  const agentSession = {
    modelRuntime,
    model,
    get sessionManager() {
      return currentSessionManager();
    },
    isStreaming: false,
    pendingMessageCount: 0,
    subscribe: () => () => {},
    dispose: () => {},
    clearQueue: () => ({ steering: [], followUp: [] }),
    // Stop does not interrupt the running tool; it finishes on its own.
    abort: async () => {
      finishTool();
      abortStream();
    },
    prompt: async (text: string) => {
      await scenario(text);
    },
  } as unknown as AgentSession;

  beforeAll(async () => {
    previousHome = process.env.OPENCANDLE_HOME;
    tempRoot = mkdtempSync(join(tmpdir(), "oc-run-cancel-tool-"));
    process.env.OPENCANDLE_HOME = join(tempRoot, "home");
    sessionDir = mkdtempSync(join(tempRoot, "session-"));

    const handler = createHttpRequestHandler({
      host: "127.0.0.1",
      port: 0,
      webDist: "/missing-web-dist",
      role: "writer",
      cwd: process.cwd(),
      agentDir: "/missing-agent-dir",
      sessionDir: "/missing-session-dir",
      privateApiSessionToken,
      localCoordinatorEndpoint: "",
      localCoordinatorSecret: "coordinator-secret",
      allowRemotePrivateApi: false,
      getSession: () => agentSession,
      getSessionManager: currentSessionManager,
      createSessionForManager: async () => ({ session: agentSession }),
      wsHub: fakeWsHub(),
      modelSetupController: fakeModelSetupController(),
      sessionActionsController: fakeSessionActionsController(),
      toolInvokeController: fakeToolInvokeController(),
      quoteSnapshotStore: fakeQuoteSnapshotStore(),
      indicesSnapshotStore: fakeIndicesStore(),
      runRegistry,
    });
    server = createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    finishTool();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousHome === undefined) delete process.env.OPENCANDLE_HOME;
    else process.env.OPENCANDLE_HOME = previousHome;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("records the user's Stop so the errored follow-up renders as Stopped", async () => {
    const actionId = "chat-stop-during-tool";
    const started = new Promise<void>((resolve) => {
      toolStarted = resolve;
    });
    const runPromise = fetch(`${endpoint}/api/sessions/${sessionId}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify({ actionId, prompt: "What is AAPL trading at?", sessionId }),
    });
    await started;
    const response = await runPromise;
    expect(response.status).toBe(200);

    const stop = await fetch(`${endpoint}/api/sessions/${sessionId}/run-cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify({ actionId: `stop-${actionId}`, targetActionId: actionId }),
    });
    await expect(stop.json()).resolves.toEqual({ ok: true, cancelled: true, duplicate: false });

    const body = await response.text();
    expect(body).toContain("Run stopped.");
    expect(body).not.toContain("run.completed");
    // The streamed turn is Stopped, never a model connection failure.
    expect(body).toContain("opencandle-run-cancelled");
    expect(body).not.toContain("opencandle-model-run-failed");

    const erroredReply = entries.find(
      (entry) =>
        entry.type === "message" &&
        (entry.message as { stopReason?: string }).stopReason === "error",
    );
    expect(erroredReply).toBeDefined();
    expect(entries.at(-1)).toMatchObject({
      type: "custom",
      customType: "opencandle-run-stopped",
      data: {
        actionId,
        prompt: "What is AAPL trading at?",
        assistantEntryIds: [erroredReply?.id],
      },
    });

    // The snapshot broadcast after the Stop (what the live GUI and a reload
    // render) already carries the marker.
    expect(snapshotsAtBroadcast.length).toBeGreaterThan(0);
    const events = sessionEntriesToChatEvents(snapshotsAtBroadcast.at(-1) ?? [], { sessionId });
    const customTypes = events
      .filter((event) => event.type === "custom.message")
      .map((event) => (event as { customType?: string }).customType);
    expect(customTypes).toContain("opencandle-run-cancelled");
    expect(customTypes).not.toContain("opencandle-model-run-failed");
    await vi.waitFor(() => expect(runRegistry.has(sessionId)).toBe(false));
  });

  it("records the Stop promptly when it cuts off a later workflow step's tool call", async () => {
    entries.length = 0;
    snapshotsAtBroadcast.length = 0;
    scenario = workflowStepTwoScenario;
    const actionId = "chat-stop-workflow-step-two";
    const prompt = "Run the multi-step analysis for AAPL";
    const streaming = new Promise<void>((resolve) => {
      stepTwoStreaming = resolve;
    });
    const runPromise = fetch(`${endpoint}/api/sessions/${sessionId}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify({ actionId, prompt, sessionId }),
    });
    await streaming;
    const response = await runPromise;
    expect(response.status).toBe(200);

    const stop = await fetch(`${endpoint}/api/sessions/${sessionId}/run-cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify({ actionId: `stop-${actionId}`, targetActionId: actionId }),
    });
    await expect(stop.json()).resolves.toEqual({ ok: true, cancelled: true, duplicate: false });

    // The run must not wait on the cut-off tool call's result, which Pi never
    // produces; before the fix it stalled until the tool-result timeout and
    // then failed without ever recording the Stop.
    const body = await response.text();
    expect(body).toContain("Run stopped.");
    expect(body).not.toContain("Timed out waiting for tool results");
    expect(body).not.toContain("opencandle-model-run-failed");

    const cutReply = entries.find(
      (entry) =>
        entry.type === "message" &&
        (entry.message as { stopReason?: string }).stopReason === "error",
    );
    expect(entries.at(-1)).toMatchObject({
      type: "custom",
      customType: "opencandle-run-stopped",
      data: { actionId, prompt, assistantEntryIds: [cutReply?.id] },
    });
    const events = sessionEntriesToChatEvents(snapshotsAtBroadcast.at(-1) ?? [], { sessionId });
    const customTypes = events
      .filter((event) => event.type === "custom.message")
      .map((event) => (event as { customType?: string }).customType);
    expect(customTypes).toContain("opencandle-run-cancelled");
    expect(customTypes).not.toContain("opencandle-model-run-failed");
    await vi.waitFor(() => expect(runRegistry.has(sessionId)).toBe(false));
  }, 15_000);

  it("names the run that owns a busy session so a Retry only waits on its own stopped run", async () => {
    entries.length = 0;
    snapshotsAtBroadcast.length = 0;
    scenario = toolRunningScenario;
    const actionId = "chat-busy-owner";
    const started = new Promise<void>((resolve) => {
      toolStarted = resolve;
    });
    const runPromise = fetch(`${endpoint}/api/sessions/${sessionId}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify({ actionId, prompt: "What is AAPL trading at?", sessionId }),
    });
    await started;

    const second = await fetch(`${endpoint}/api/sessions/${sessionId}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify({ actionId: "chat-busy-second", prompt: "Retry", sessionId }),
    });
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({
      code: "session_busy",
      activeActionId: actionId,
    });

    await fetch(`${endpoint}/api/sessions/${sessionId}/run-cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify({ actionId: `stop-${actionId}`, targetActionId: actionId }),
    });
    await (await runPromise).text();
    await vi.waitFor(() => expect(runRegistry.has(sessionId)).toBe(false));
  });

  it("frees the session promptly when Stop ends a multi-step workflow run", async () => {
    // A workflow prompt widens the settle idle grace (the next step may still
    // be on its way). A stopped workflow sends no further steps, so the run
    // must not hold the session busy for that grace: a Retry right after Stop
    // was rejected with 409 session_busy for about 30 seconds.
    entries.length = 0;
    snapshotsAtBroadcast.length = 0;
    scenario = toolRunningScenario;
    const actionId = "chat-stop-workflow-grace";
    const started = new Promise<void>((resolve) => {
      toolStarted = resolve;
    });
    const runPromise = fetch(`${endpoint}/api/sessions/${sessionId}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify({ actionId, prompt: "Analyze AAPL", sessionId }),
    });
    await started;
    const response = await runPromise;
    expect(response.status).toBe(200);

    const stoppedAt = Date.now();
    const stop = await fetch(`${endpoint}/api/sessions/${sessionId}/run-cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify({ actionId: `stop-${actionId}`, targetActionId: actionId }),
    });
    await expect(stop.json()).resolves.toEqual({ ok: true, cancelled: true, duplicate: false });

    const body = await response.text();
    expect(body).toContain("Run stopped.");
    await vi.waitFor(() => expect(runRegistry.has(sessionId)).toBe(false), {
      timeout: 10_000,
      interval: 25,
    });
    expect(Date.now() - stoppedAt).toBeLessThan(5_000);
  }, 45_000);

  function push(message: Record<string, unknown>): void {
    entries.push({
      id: `entry-${entries.length}`,
      type: "message",
      message: { timestamp: Date.now(), ...message },
      timestamp: new Date().toISOString(),
    } as unknown as SessionEntry);
  }

  function fakeWsHub(): WsHub {
    return {
      handleUpgrade: vi.fn(),
      getClientCount: () => 0,
      closeClients: vi.fn(),
      sendBoot: vi.fn(),
      buildBootstrapPayload: async () => ({}),
      broadcast: vi.fn(),
      broadcastModelSetup: vi.fn(),
      broadcastState: vi.fn(() => {
        snapshotsAtBroadcast.push([...entries]);
      }),
      broadcastSessionSnapshot: vi.fn(),
      broadcastSessions: vi.fn(),
      buildStateSnapshot: () => ({ sessionId: "session", state: {}, entries: [], events: [] }),
      currentChatEvents: () => [],
      subscribeToSessionEvents: () => () => {},
    } as unknown as WsHub;
  }

  function fakeModelSetupController(): ModelSetupController {
    return {
      buildCurrentModelSetupState: () => ({
        requirement: "ready",
        providers: [],
        availableModels: [],
      }),
      handleSaveModelApiKey: async () => {},
      handleSaveProviderApiKey: async () => {},
      handleSelectModel: async () => {},
    };
  }

  function fakeSessionActionsController(): SessionActionsController {
    return {
      handleAskUserAnswer: async () => {},
      handleAskUserCancel: async () => {},
      handleNewSession: async () => {},
      handleOpenSession: async () => {},
      handleRenameSession: async () => {},
      handleDeleteSession: async () => {},
    };
  }

  function fakeToolInvokeController(): ToolInvokeController {
    return {
      handleToolInvoke: async () => {
        throw new Error("not used by run-admission lock failure tests");
      },
      handleToolInvokeMessage: async () => {},
    };
  }

  function fakeQuoteSnapshotStore(): QuoteSnapshotStore {
    return {
      get: async () => ({ updatedAt: new Date().toISOString(), quotes: [] }),
      invalidate: vi.fn(),
    } as unknown as QuoteSnapshotStore;
  }

  function fakeIndicesStore() {
    return {
      get: async () => ({ updatedAt: new Date().toISOString(), indices: [] }),
      invalidate: vi.fn(),
    } as never;
  }
});
