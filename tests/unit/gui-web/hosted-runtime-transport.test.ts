import { describe, expect, it, vi } from "vitest";
import { createHostedRuntimeTransport } from "../../../gui/web/src/runtime/hosted-runtime-transport.js";

function createHost() {
  const bootstrap = {
    role: "writer",
    sessionId: "session-1",
    sessions: [{ id: "session-1", name: "First session" }],
    catalog: { tools: [], workflows: [], providers: [] },
    snapshot: {
      sessionId: "session-1",
      entries: [],
      events: [],
      state: { knownSymbols: [], watchlist: [] },
    },
  };
  return {
    request: vi.fn(async (_operation: string, payload: Record<string, unknown>) => {
      switch (payload.action) {
        case "bootstrap":
          return bootstrap;
        case "new_session":
          return { ...bootstrap, sessionId: "session-2" };
        case "load_session":
          return { ...bootstrap, sessionId: payload.sessionId };
        case "chat_run":
          return {
            ...bootstrap,
            events: [
              {
                v: 1,
                seq: 0,
                type: "run.started",
                sessionId: payload.sessionId,
                runId: "run-1",
                timestamp: "2026-07-30T00:00:00.000Z",
              },
              {
                v: 1,
                seq: 1,
                type: "run.completed",
                sessionId: payload.sessionId,
                runId: "run-1",
                timestamp: "2026-07-30T00:00:01.000Z",
              },
            ],
          };
        case "tool_invoke":
          return { result: { saved: true, symbol: "AAPL" } };
        default:
          return { ok: true };
      }
    }),
    getModelSetup: vi.fn(() => ({
      requirement: "ready",
      currentModel: "openai/gpt-4.1-mini",
      providers: [],
      availableModels: [],
    })),
    handleCommand: vi.fn(async () => ({ ok: true })),
  };
}

describe("hosted runtime transport", () => {
  it("merges browser-owned model setup into the canonical bootstrap", async () => {
    const host = createHost();
    const transport = createHostedRuntimeTransport({ host });

    expect(transport.initialModelSetup).toMatchObject({
      requirement: "ready",
      currentModel: "openai/gpt-4.1-mini",
    });

    await expect(transport.bootstrap()).resolves.toMatchObject({
      role: "writer",
      sessionId: "session-1",
      modelSetup: { requirement: "ready" },
      supportsSessionActions: true,
    });
  });

  it("presents hosted chat results as the same SSE response consumed by the local GUI", async () => {
    const host = createHost();
    const transport = createHostedRuntimeTransport({ host });

    const response = await transport.startChatRun(
      "session-1",
      { prompt: "What changed?", sessionId: "session-1", actionId: "chat-1" },
      new AbortController().signal,
    );

    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body).toContain('"type":"run.started"');
    expect(body).toContain('"type":"run.completed"');
    expect(host.request).toHaveBeenCalledWith(
      "gui",
      expect.objectContaining({
        action: "chat_run",
        sessionId: "session-1",
        prompt: "What changed?",
      }),
      expect.any(Object),
    );
  });

  it("refreshes the completed target session after a streamed run is consumed", async () => {
    const host = createHost();
    host.streamRequest = vi.fn(
      async () =>
        new Response('data: {"type":"run.completed"}\n\n', {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const transport = createHostedRuntimeTransport({ host });

    const response = await transport.startChatRun(
      "session-1",
      { prompt: "What changed?", sessionId: "session-1", actionId: "chat-stream" },
      new AbortController().signal,
    );
    await response.text();

    expect(host.request).toHaveBeenCalledWith("gui", { action: "bootstrap" }, undefined);
  });

  it("emulates the GUI event channel and refreshes snapshots after a run", async () => {
    const host = createHost();
    const transport = createHostedRuntimeTransport({ host });
    const messages: Array<Record<string, unknown>> = [];
    const channel = transport.openEventChannel({
      onMessage: (message: string) => messages.push(JSON.parse(message)),
      onClose: vi.fn(),
    });

    await vi.waitFor(() => expect(messages.some((message) => message.type === "boot")).toBe(true));
    await transport.startChatRun(
      "session-1",
      { prompt: "What changed?", sessionId: "session-1", actionId: "chat-1" },
      new AbortController().signal,
    );
    await vi.waitFor(() =>
      expect(messages.some((message) => message.type === "state.snapshot")).toBe(true),
    );

    expect(channel?.readyState).toBe(1);
    channel?.close();
  });

  it("publishes hosted role changes without re-emitting boot on runtime invalidation", async () => {
    const host = createHost();
    let role = "writer";
    let invalidate = (_message?: { type: string }) => {};
    host.request.mockImplementation(
      async (_operation: string, payload: Record<string, unknown>) => {
        if (payload.action === "bootstrap") {
          return {
            role,
            sessionId: "session-1",
            sessions: [],
            coordination: { sessionId: "session-1", ownerKind: role, writable: role !== "offline" },
            catalog: { tools: [], workflows: [], providers: [] },
            snapshot: { sessionId: "session-1", entries: [], events: [], state: {} },
          };
        }
        return { ok: true };
      },
    );
    Object.assign(host, {
      subscribe: (listener: () => void) => {
        invalidate = listener;
        return () => {};
      },
    });
    const transport = createHostedRuntimeTransport({ host });
    const messages: Array<Record<string, unknown>> = [];
    const channel = transport.openEventChannel({
      onMessage: (message: string) => messages.push(JSON.parse(message)),
      onClose: vi.fn(),
    });
    await vi.waitFor(() => expect(messages.some((message) => message.type === "boot")).toBe(true));

    const bootCount = messages.filter((message) => message.type === "boot").length;
    role = "offline";
    invalidate({ type: "coordination" });

    await vi.waitFor(() =>
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: "state.snapshot",
          coordination: expect.anything(),
        }),
      ),
    );
    expect(messages.filter((message) => message.type === "boot")).toHaveLength(bootCount);
    channel?.close();
  });

  it("routes model setup and session actions through the host command boundary", async () => {
    const host = createHost();
    const transport = createHostedRuntimeTransport({ host });
    const messages: string[] = [];
    const channel = transport.openEventChannel({
      onMessage: (message: string) => messages.push(message),
      onClose: vi.fn(),
    });
    await vi.waitFor(() => expect(messages.length).toBeGreaterThan(0));

    channel?.send(
      JSON.stringify({
        type: "model.setup.save_api_key",
        provider: "openai",
        apiKey: "secret",
        sessionId: "session-1",
      }),
    );

    await vi.waitFor(() =>
      expect(host.handleCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "model.setup.save_api_key",
          apiKey: "secret",
        }),
      ),
    );
    channel?.close();
  });

  it("settles socket-shaped tool invocations through the hosted tool boundary", async () => {
    const host = createHost();
    const transport = createHostedRuntimeTransport({ host });
    const messages: Array<Record<string, unknown>> = [];
    const channel = transport.openEventChannel({
      onMessage: (message: string) => messages.push(JSON.parse(message)),
      onClose: vi.fn(),
    });
    await vi.waitFor(() => expect(messages.some((message) => message.type === "boot")).toBe(true));

    channel?.send(
      JSON.stringify({
        type: "tool.invoke",
        requestId: "request-1",
        actionId: "action-1",
        sessionId: "session-1",
        toolName: "manage_watchlist",
        args: { action: "add", symbol: "AAPL" },
      }),
    );

    await vi.waitFor(() =>
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: "tool.invoke.result",
          requestId: "request-1",
          ok: true,
          result: { saved: true, symbol: "AAPL" },
        }),
      ),
    );
    expect(host.request).toHaveBeenCalledWith(
      "gui",
      expect.objectContaining({ action: "tool_invoke", toolName: "manage_watchlist" }),
      undefined,
    );
    expect(host.handleCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "tool.invoke" }),
    );
    channel?.close();
  });
});
