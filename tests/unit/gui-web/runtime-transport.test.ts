import { describe, expect, it, vi } from "vitest";
import {
  actionSurfaceRole,
  createLoopbackRuntimeTransport,
  runtimeTransportContractVersion,
} from "../../../gui/web/src/runtime/runtime-transport.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("loopback runtime transport", () => {
  it("keeps online forwarding tabs actionable without enabling offline or local followers", () => {
    expect(actionSurfaceRole("follower", true)).toBe("writer");
    expect(actionSurfaceRole("follower", false)).toBe("follower");
    expect(actionSurfaceRole("writer", false)).toBe("offline");
    expect(actionSurfaceRole("offline", false)).toBe("offline");
  });

  it("uses the existing bootstrap, session, tool, and run contracts", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return jsonResponse({ ok: true, sessionId: "session-1", result: { symbol: "AAPL" } });
    });
    const transport = createLoopbackRuntimeTransport({ fetchImpl });

    await transport.bootstrap();
    await transport.createSession();
    await transport.loadSession("session/one");
    await transport.invokeTool({
      actionId: "tool-1",
      sessionId: "session-1",
      toolName: "get_stock_quote",
      args: { symbol: "AAPL" },
    });
    await transport.startChatRun(
      "session/one",
      { prompt: "What changed?", sessionId: "session/one", actionId: "chat-1" },
      new AbortController().signal,
    );

    expect(requests.map(({ url }) => url)).toEqual([
      "/api/bootstrap",
      "/api/session/new",
      "/api/sessions/session%2Fone/bootstrap",
      "/api/tool-invoke",
      "/api/sessions/session%2Fone/runs",
    ]);
    expect(requests[3]?.init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(requests[4]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(runtimeTransportContractVersion).toBe(1);
  });

  it("normalizes JSON errors without hiding the server message", async () => {
    const transport = createLoopbackRuntimeTransport({
      fetchImpl: vi.fn(async () => jsonResponse({ error: "writer is read-only" }, { status: 409 })),
    });

    await expect(transport.createSession()).rejects.toThrow("writer is read-only");
  });

  it("opens the existing websocket channel and exposes a bounded connection surface", () => {
    const constructed: string[] = [];
    let openedSocket: FakeWebSocket | undefined;
    class FakeWebSocket {
      static OPEN = 1;
      readyState = FakeWebSocket.OPEN;
      onmessage?: (event: { data: string }) => void;
      onclose?: () => void;
      constructor(url: string) {
        constructed.push(url);
        openedSocket = this;
      }
      send = vi.fn();
      close = vi.fn();
    }
    const messages: string[] = [];
    const transport = createLoopbackRuntimeTransport({
      fetchImpl: vi.fn(),
      WebSocketImpl: FakeWebSocket,
      location: { protocol: "https:", host: "research.local" },
    });
    const channel = transport.openEventChannel({
      onMessage: (message) => messages.push(message),
      onClose: vi.fn(),
    });
    openedSocket?.onmessage?.({ data: '{"type":"boot"}' });
    channel.send("payload");

    expect(constructed).toEqual(["wss://research.local/ws"]);
    expect(messages).toEqual(['{"type":"boot"}']);
    expect(channel.readyState).toBe(1);
    expect(openedSocket?.send).toHaveBeenCalledWith("payload");
  });
});
