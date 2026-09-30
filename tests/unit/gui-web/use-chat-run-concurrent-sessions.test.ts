// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatRun } from "../../../gui/web/src/hooks/useChatRun.jsx";
import { RuntimeTransportContext } from "../../../gui/web/src/runtime/runtime-transport-context.js";

let latestRun: ReturnType<typeof useChatRun> | undefined;
let root: Root;
let container: HTMLDivElement;

function Probe({ activeSessionId }: { activeSessionId: string }) {
  latestRun = useChatRun({
    activeSessionId,
    setToast: vi.fn(),
    onRunStart: vi.fn(),
    onRunError: vi.fn(),
  });
  return null;
}

function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

function sseBlock(event: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  latestRun = undefined;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("useChatRun across sessions", () => {
  it("keeps a running session's stream while another session's run starts and completes", async () => {
    let sessionAStream!: ReadableStreamDefaultController<Uint8Array>;
    const transport = {
      startChatRun: vi.fn(async (sessionId: string) => {
        if (sessionId === "session-a") {
          return sseResponse(
            new ReadableStream({
              start(controller) {
                sessionAStream = controller;
                controller.enqueue(sseBlock({ type: "run.started", sessionId: "session-a" }));
              },
            }),
          );
        }
        return sseResponse(
          new ReadableStream({
            start(controller) {
              controller.enqueue(sseBlock({ type: "run.started", sessionId }));
              controller.enqueue(sseBlock({ type: "run.completed", sessionId }));
              controller.close();
            },
          }),
        );
      }),
    };
    const render = (activeSessionId: string) =>
      act(async () =>
        root.render(
          React.createElement(
            RuntimeTransportContext.Provider,
            { value: transport },
            React.createElement(Probe, { activeSessionId }),
          ),
        ),
      );

    await render("session-a");
    let runA: Promise<unknown> | undefined;
    await act(async () => {
      runA = latestRun?.startChatRun("Build me a balanced portfolio with $50,000");
    });
    expect(latestRun?.runStates["session-a"]).toBe("streaming");

    // The user opens a new chat and sends there while A is still streaming.
    await render("session-b");
    expect(latestRun?.runState).toBe("ready");
    await act(async () => latestRun?.startChatRun("What is AAPL trading at?"));

    expect(transport.startChatRun).toHaveBeenCalledTimes(2);
    expect(transport.startChatRun.mock.calls.map(([sessionId]) => sessionId)).toEqual([
      "session-a",
      "session-b",
    ]);
    expect(latestRun?.runStates["session-b"]).toBe("ready");
    expect(latestRun?.runStates["session-a"]).toBe("streaming");

    await act(async () => {
      sessionAStream.enqueue(sseBlock({ type: "run.completed", sessionId: "session-a" }));
      sessionAStream.close();
      await runA;
    });
    expect(latestRun?.runStates["session-a"]).toBe("ready");
  });
});
