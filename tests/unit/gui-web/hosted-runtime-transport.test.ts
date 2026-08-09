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
          return {
            ...bootstrap,
            snapshot: {
              ...bootstrap.snapshot,
              events: [
                {
                  type: "tool.started",
                  sessionId: "session-1",
                  seq: 1,
                  toolCallId: "tool-1",
                  messageId: "assistant-1",
                  name: "get_stock_quote",
                  input: { symbol: "AAPL" },
                },
                {
                  type: "tool.completed",
                  sessionId: "session-1",
                  seq: 2,
                  toolCallId: "tool-1",
                  output: { content: [{ type: "text", text: "AAPL quote" }] },
                },
              ],
            },
            result: { saved: true, symbol: "AAPL" },
          };
        default:
          return { ok: true };
      }
    }),
    streamRequest: vi.fn(async (_operation: string, payload: Record<string, unknown>) => {
      const events = [
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
      ];
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      });
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
  it("carries the hosted data actions so Settings can run them", () => {
    const hostedData = { exportData: vi.fn() };

    expect(createHostedRuntimeTransport({ host: createHost(), hostedData }).hostedData).toBe(
      hostedData,
    );
    expect(createHostedRuntimeTransport({ host: createHost() }).hostedData).toBeNull();
  });

  it("requires the canonical streaming runtime boundary", () => {
    const host = createHost();
    delete (host as Partial<typeof host>).streamRequest;

    expect(() => createHostedRuntimeTransport({ host })).toThrow(
      "Hosted runtime transport requires streaming request support",
    );
  });

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

  it("advertises offline hosted bootstraps as read-only for session actions", async () => {
    const host = createHost();
    Object.assign(host, { getRole: vi.fn(() => "follower") });
    host.request.mockResolvedValueOnce({
      role: "offline",
      sessionId: "session-1",
      sessions: [],
      coordination: { ownerKind: "offline", writable: false },
      snapshot: { sessionId: "session-1", entries: [], events: [], state: {} },
    });
    const transport = createHostedRuntimeTransport({ host });

    await expect(transport.bootstrap()).resolves.toMatchObject({
      role: "offline",
      supportsSessionActions: false,
      coordination: { writable: false },
    });
  });

  it("keeps a follower action-capable while it forwards to the writer", async () => {
    const host = createHost();
    const followerHost = {
      ...host,
      getRole: vi.fn(() => "follower"),
    };
    const transport = createHostedRuntimeTransport({ host: followerHost });

    await expect(transport.bootstrap()).resolves.toMatchObject({
      role: "follower",
      supportsSessionActions: true,
      coordination: { writable: true },
    });
  });

  it("presents hosted Pi events as the same SSE response consumed by the local GUI", async () => {
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
    expect(host.streamRequest).toHaveBeenCalledWith(
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

  it("refreshes canonical state when a hosted stream fails while being consumed", async () => {
    const host = createHost();
    host.streamRequest = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("stream failed"));
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const transport = createHostedRuntimeTransport({ host });

    const response = await transport.startChatRun(
      "session-1",
      { prompt: "What changed?", actionId: "chat-stream-failed" },
      new AbortController().signal,
    );

    await expect(response.text()).rejects.toThrow("stream failed");
    expect(host.request).toHaveBeenCalledWith("gui", { action: "bootstrap" }, undefined);
  });

  it("refreshes canonical state when a hosted stream fails before returning a response", async () => {
    const host = createHost();
    host.streamRequest = vi.fn(async () => {
      throw new Error("stream did not start");
    });
    const transport = createHostedRuntimeTransport({ host });

    const response = await transport.startChatRun(
      "session-1",
      { prompt: "What changed?", actionId: "chat-stream-start-failed" },
      new AbortController().signal,
    );

    expect(response.status).toBe(500);
    expect(host.request).toHaveBeenCalledWith("gui", { action: "bootstrap" }, undefined);
  });

  it("refreshes canonical state when a hosted stream is cancelled", async () => {
    const host = createHost();
    const cancelStream = vi.fn();
    host.streamRequest = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"type":"run.started"}\n\n'));
            },
            cancel: cancelStream,
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const transport = createHostedRuntimeTransport({ host });

    const response = await transport.startChatRun(
      "session-1",
      { prompt: "What changed?", actionId: "chat-stream-cancelled" },
      new AbortController().signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    host.request.mockClear();

    await response.body!.cancel("user cancelled");

    expect(cancelStream).toHaveBeenCalledWith("user cancelled");
    expect(host.request).toHaveBeenCalledWith("gui", { action: "bootstrap" }, undefined);
  });

  it("publishes the refreshed preferences snapshot after a hosted delete", async () => {
    const host = createHost();
    const snapshot = { preferences: [], toolDefaults: [] };
    host.handleCommand = vi.fn(async () => snapshot);
    const transport = createHostedRuntimeTransport({ host });
    const messages: Array<Record<string, unknown>> = [];
    transport.openEventChannel({
      onMessage: (message: string) => messages.push(JSON.parse(message)),
      onClose: vi.fn(),
    });

    await transport.deletePreference({ namespace: "workflow", key: "risk_profile" });

    await vi.waitFor(() =>
      expect(messages.some((message) => message.type === "preferences")).toBe(true),
    );
    expect(host.handleCommand).toHaveBeenCalledWith({
      type: "preferences.delete",
      namespace: "workflow",
      key: "risk_profile",
    });
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

  it("closes the hosted event channel immediately when initial bootstrap fails", async () => {
    const host = createHost();
    host.request.mockRejectedValueOnce(new Error("WebContainer unavailable"));
    const transport = createHostedRuntimeTransport({ host });
    const messages: Array<Record<string, unknown>> = [];
    const onClose = vi.fn();
    const channel = transport.openEventChannel({
      onMessage: (message: string) => messages.push(JSON.parse(message)),
      onClose,
    });

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(channel?.readyState).toBe(3);
    expect(messages).toContainEqual(
      expect.objectContaining({ type: "error", message: "WebContainer unavailable" }),
    );
  });

  it("publishes hosted role changes without racing a bootstrap during runtime handoff", async () => {
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
      getRole: () => role,
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
    const bootstrapRequests = host.request.mock.calls.filter(
      ([, payload]) => payload.action === "bootstrap",
    ).length;
    role = "offline";
    invalidate({ type: "coordination" });

    await vi.waitFor(() =>
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: "runtime.status",
          role: "offline",
          coordination: expect.objectContaining({ writable: false }),
        }),
      ),
    );
    expect(messages.filter((message) => message.type === "boot")).toHaveLength(bootCount);
    expect(
      host.request.mock.calls.filter(([, payload]) => payload.action === "bootstrap"),
    ).toHaveLength(bootstrapRequests);
    channel?.close();
  });

  it("keeps controls read-only when an offline coordination notification reports a stale writer", async () => {
    const host = createHost();
    let notify = (_message?: { type: string }) => {};
    Object.assign(host, {
      getRole: () => "writer",
      subscribe: (listener: (message: { type: string }) => void) => {
        notify = listener;
        return () => {};
      },
    });
    vi.stubGlobal("navigator", { onLine: false });
    try {
      const transport = createHostedRuntimeTransport({ host });
      const messages: Array<Record<string, unknown>> = [];
      const channel = transport.openEventChannel({
        onMessage: (message: string) => messages.push(JSON.parse(message)),
        onClose: vi.fn(),
      });
      await vi.waitFor(() =>
        expect(messages.some((message) => message.type === "boot")).toBe(true),
      );

      notify({ type: "coordination" });

      await vi.waitFor(() =>
        expect(messages).toContainEqual(
          expect.objectContaining({
            type: "runtime.status",
            role: "offline",
            coordination: expect.objectContaining({ writable: false }),
            supportsSessionActions: false,
          }),
        ),
      );
      channel?.close();
    } finally {
      vi.unstubAllGlobals();
    }
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

  it("restores the GUI command type when an HTTP fallback route carries only its body", async () => {
    const host = createHost();
    const transport = createHostedRuntimeTransport({ host });

    await transport.postCommand("/api/model-setup/api-key", {
      provider: "openai",
      apiKey: "secret",
      storageMode: "session",
    });

    expect(host.handleCommand).toHaveBeenCalledWith({
      type: "model.setup.save_api_key",
      provider: "openai",
      apiKey: "secret",
      storageMode: "session",
    });

    await transport.postCommand("/api/model-setup/thinking", { level: "high" });
    expect(host.handleCommand).toHaveBeenCalledWith({
      type: "model.setup.set_thinking",
      level: "high",
    });
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
    expect(
      host.request.mock.calls.filter(([, payload]) => payload.action === "bootstrap"),
    ).toHaveLength(1);
    await vi.waitFor(() =>
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: "state.snapshot",
          snapshot: expect.objectContaining({
            events: expect.arrayContaining([
              expect.objectContaining({ type: "tool.completed", toolCallId: "tool-1" }),
            ]),
          }),
        }),
      ),
    );
    expect(host.handleCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "tool.invoke" }),
    );
    channel?.close();
  });
});
