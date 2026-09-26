import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { initDatabase } from "../../../src/memory/sqlite.js";
import openCandleExtension from "../../../src/pi/opencandle-extension.js";
import {
  createSessionCancellationState,
  startSessionRun,
} from "../../../src/pi/session-cancellation.js";

const { routeMock } = vi.hoisted(() => ({ routeMock: vi.fn() }));

// Force the router await itself to reject so the extension's catch path (not
// route()'s internal fallback) is exercised.
vi.mock("../../../src/routing/router.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/routing/router.js")>();
  return { ...actual, route: routeMock };
});

type EventHandler = (...args: any[]) => any;

function createFakeApi() {
  const handlers = new Map<string, EventHandler[]>();
  const sendUserMessage = vi.fn();
  const api = {
    on(event: string, handler: EventHandler) {
      const bucket = handlers.get(event) ?? [];
      bucket.push(handler);
      handlers.set(event, bucket);
    },
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    registerFlag: vi.fn(),
    getFlag: vi.fn(),
    registerMessageRenderer: vi.fn(),
    sendMessage: vi.fn(),
    sendUserMessage,
    appendEntry: vi.fn(),
    setSessionName: vi.fn(),
    getSessionName: vi.fn(),
    setLabel: vi.fn(),
    exec: vi.fn(),
    getActiveTools: vi.fn(),
    getAllTools: vi.fn(),
    setActiveTools: vi.fn(),
    getCommands: vi.fn(),
    setModel: vi.fn(),
    getThinkingLevel: vi.fn(),
    setThinkingLevel: vi.fn(),
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
  } as unknown as ExtensionAPI;
  return { api, handlers, sendUserMessage };
}

describe("router rejection cancellation", () => {
  it("does not fall through to the agent when a cancelled router request rejects", async () => {
    const database = initDatabase(":memory:");
    const fake = createFakeApi();
    const cancellation = createSessionCancellationState();
    const token = startSessionRun(cancellation);
    routeMock.mockImplementationOnce(async () => {
      token.cancel();
      throw new Error("router request aborted");
    });

    openCandleExtension(fake.api, {
      cancellation,
      routerLlmClient: { complete: async () => "{}" },
      stateDatabaseFactory: () => database,
    });

    const sessionStart = fake.handlers.get("session_start")?.[0];
    await sessionStart!(
      { type: "session_start" },
      {
        hasUI: false,
        sessionManager: { getSessionId: () => "reject-session" },
        ui: { notify: vi.fn() },
      },
    );

    const inputHandler = fake.handlers.get("input")?.[0];
    const result = await inputHandler!(
      { type: "input", text: "reject then stop", source: "interactive" },
      {
        isIdle: () => true,
        ui: { notify: vi.fn() },
        sessionManager: { getBranch: () => [], getSessionId: () => "reject-session" },
      },
    );

    expect(routeMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ action: "handled" });
    expect(fake.api.appendEntry).toHaveBeenCalledWith(
      "opencandle-run-cancelled",
      expect.objectContaining({ text: "reject then stop" }),
    );
    expect(fake.api.appendEntry).not.toHaveBeenCalledWith("opencandle-router", expect.anything());
    expect(fake.sendUserMessage).not.toHaveBeenCalled();
    database.close();
  });
});
