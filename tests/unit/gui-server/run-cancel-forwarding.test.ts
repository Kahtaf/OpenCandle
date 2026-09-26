import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHttpRequestHandler } from "../../../gui/server/http-routes.js";
import type { ToolInvokeController } from "../../../gui/server/invoke-tool.js";
import type { ModelSetupController } from "../../../gui/server/model-setup.js";
import { privateApiCookieHeader } from "../../../gui/server/private-api-access.js";
import type { QuoteSnapshotStore } from "../../../gui/server/quote-snapshot-store.js";
import { createGuiRunRegistry, type GuiRunRegistry } from "../../../gui/server/run-cancellation.js";
import type { SessionActionsController } from "../../../gui/server/session-actions.js";
import { acquireWriterLock, writerLockScopeForSession } from "../../../gui/server/writer-lock.js";
import type { WsHub } from "../../../gui/server/ws-hub.js";

const OWNER_SECRET = "owner-coordinator-secret";
const FOLLOWER_TOKEN = "follower-private-token";
const SESSION_ID = "forwarded-session";
const ORIGINAL_ACTION_ID = "chat-original";
const TARGET_ACTION_ID = "chat-original";

let tempDir = "";
let sessionFile = "";

describe("run cancellation owner forwarding", () => {
  let ownerServer: Server;
  let ownerEndpoint: string;
  let followerServer: Server;
  let followerEndpoint: string;
  let child: ChildProcess;
  let runRegistry: GuiRunRegistry;
  let applyCancel: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "opencandle-run-cancel-forward-"));
    sessionFile = join(tempDir, "session.jsonl");

    // A genuinely-live process with a pid distinct from this test process, so
    // hasLiveCoordinatorLock accepts the owner lock as another process.
    child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    await new Promise<void>((resolve) => child.once("spawn", () => resolve()));
    const ownerPid = child.pid;
    expect(ownerPid).toBeTypeOf("number");

    runRegistry = createGuiRunRegistry();
    applyCancel = vi.fn();
    runRegistry
      .start({ sessionId: SESSION_ID, actionId: ORIGINAL_ACTION_ID })!
      .setApplyCancel(applyCancel);

    ownerServer = createServer(
      createHandler({
        role: "writer",
        privateApiSessionToken: "owner-token",
        localCoordinatorSecret: OWNER_SECRET,
        sessionId: SESSION_ID,
        sessionFile,
        runRegistry,
      }),
    );
    ownerEndpoint = await listen(ownerServer);

    followerServer = createServer(
      createHandler({
        role: "follower",
        privateApiSessionToken: FOLLOWER_TOKEN,
        localCoordinatorSecret: "follower-unused-secret",
        sessionId: SESSION_ID,
        sessionFile,
      }),
    );
    followerEndpoint = await listen(followerServer);

    // The follower's writer lock points at the owner process/endpoint with the
    // authenticated secret the owner route checks.
    await acquireWriterLock(
      writerLockScopeForSession(sessionManager(SESSION_ID, sessionFile)),
      "gui",
      {
        pid: ownerPid,
        coordinatorEndpoint: ownerEndpoint,
        coordinatorSecret: OWNER_SECRET,
      },
    );
  });

  afterAll(async () => {
    child.kill();
    await Promise.all([close(ownerServer), close(followerServer)]);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("forwards a follower stop to the authenticated owner and delivers the original target", async () => {
    const response = await fetch(`${followerEndpoint}/api/sessions/${SESSION_ID}/run-cancel`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: privateApiCookieHeader(FOLLOWER_TOKEN),
      },
      body: JSON.stringify({ actionId: "stop-1", targetActionId: TARGET_ACTION_ID }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      cancelled: true,
      duplicate: false,
    });
    expect(applyCancel).toHaveBeenCalledOnce();
  });

  it("sets run.cancel at the forwarding boundary and ignores a caller-supplied action type", async () => {
    // A fresh registry run so the previous cancellation does not short-circuit.
    const secondRegistry = createGuiRunRegistry();
    const secondApply = vi.fn();
    secondRegistry
      .start({ sessionId: SESSION_ID, actionId: ORIGINAL_ACTION_ID })!
      .setApplyCancel(secondApply);
    const replacementOwner = createServer(
      createHandler({
        role: "writer",
        privateApiSessionToken: "owner-token",
        localCoordinatorSecret: OWNER_SECRET,
        sessionId: SESSION_ID,
        sessionFile,
        runRegistry: secondRegistry,
      }),
    );
    const replacementEndpoint = await listen(replacementOwner);
    try {
      await acquireWriterLock(
        writerLockScopeForSession(sessionManager(SESSION_ID, sessionFile)),
        "gui",
        {
          pid: child.pid,
          coordinatorEndpoint: replacementEndpoint,
          coordinatorSecret: OWNER_SECRET,
          // The existing lock is still considered alive; force a fresh write.
          staleGraceMs: 0,
          isPidAlive: () => false,
        },
      );

      const response = await fetch(`${followerEndpoint}/api/sessions/${SESSION_ID}/run-cancel`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: privateApiCookieHeader(FOLLOWER_TOKEN),
        },
        body: JSON.stringify({
          actionId: "stop-override",
          targetActionId: TARGET_ACTION_ID,
          actionType: "evil.override",
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        cancelled: true,
        duplicate: false,
      });
      expect(secondApply).toHaveBeenCalledOnce();
    } finally {
      await close(replacementOwner);
    }
  });

  it("fails closed with a non-2xx when a live foreign owner is unreachable, without a local cancel", async () => {
    const failureSession = "unreachable-owner-session";
    const failureSessionFile = join(tempDir, "unreachable-session.jsonl");
    const localRegistry = createGuiRunRegistry();
    const localCancel = vi.fn();
    localRegistry
      .start({ sessionId: failureSession, actionId: TARGET_ACTION_ID })!
      .setApplyCancel(localCancel);

    const failureServer = createServer(
      createHandler({
        role: "follower",
        privateApiSessionToken: FOLLOWER_TOKEN,
        localCoordinatorSecret: "follower-unused-secret",
        sessionId: failureSession,
        sessionFile: failureSessionFile,
        runRegistry: localRegistry,
      }),
    );
    const failureEndpoint = await listen(failureServer);
    try {
      // Live foreign owner lock (live pid) but an unreachable coordinator
      // endpoint: the Stop cannot be delivered and must not read as "no active
      // run" locally.
      await acquireWriterLock(
        writerLockScopeForSession(sessionManager(failureSession, failureSessionFile)),
        "gui",
        {
          pid: child.pid,
          coordinatorEndpoint: "http://127.0.0.1:1",
          coordinatorSecret: "unreachable-owner-secret",
        },
      );

      const response = await fetch(`${failureEndpoint}/api/sessions/${failureSession}/run-cancel`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: privateApiCookieHeader(FOLLOWER_TOKEN),
        },
        body: JSON.stringify({ actionId: "stop-fail", targetActionId: TARGET_ACTION_ID }),
      });

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: "Could not reach the session owner to confirm the run stopped.",
        code: "cancel_forward_failed",
      });
      expect(localCancel).not.toHaveBeenCalled();
      expect(localRegistry.has(failureSession)).toBe(true);
    } finally {
      await close(failureServer);
    }
  });
});

function createHandler(input: {
  role: string;
  privateApiSessionToken: string;
  localCoordinatorSecret: string;
  sessionId: string;
  sessionFile: string;
  runRegistry?: GuiRunRegistry;
}): (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void {
  const handler = createHttpRequestHandler({
    host: "127.0.0.1",
    port: 0,
    webDist: "/missing-web-dist",
    role: input.role,
    cwd: tempDir ?? process.cwd(),
    agentDir: "/missing-agent-dir",
    sessionDir: tempDir ?? process.cwd(),
    privateApiSessionToken: input.privateApiSessionToken,
    localCoordinatorEndpoint: "",
    localCoordinatorSecret: input.localCoordinatorSecret,
    allowRemotePrivateApi: false,
    getSession: () => ({}) as AgentSession,
    getSessionManager: () => sessionManager(input.sessionId, input.sessionFile),
    createSessionForManager: async () => ({ session: {} as AgentSession }),
    wsHub: fakeWsHub(),
    modelSetupController: fakeModelSetupController(),
    sessionActionsController: fakeSessionActionsController(),
    toolInvokeController: fakeToolInvokeController(),
    quoteSnapshotStore: fakeQuoteSnapshotStore(),
    indicesSnapshotStore: fakeIndicesStore(),
    runRegistry: input.runRegistry,
  });
  return (req, res) => {
    void handler(req, res);
  };
}

function sessionManager(sessionId: string, sessionFile: string): SessionManager {
  return {
    getSessionId: () => sessionId,
    getSessionFile: () => sessionFile,
    getSessionDir: () => tempDir,
  } as unknown as SessionManager;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
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
    broadcastState: vi.fn(),
    broadcastSessionSnapshot: vi.fn(),
    broadcastSessions: vi.fn(),
    buildStateSnapshot: () => ({ sessionId: "session", state: {}, entries: [], events: [] }),
    currentChatEvents: () => [],
    subscribeToSessionEvents: () => () => {},
  };
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
      throw new Error("not used by run cancellation forwarding tests");
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
