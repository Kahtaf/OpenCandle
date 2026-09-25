// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatRun } from "../../../gui/web/src/hooks/useChatRun.jsx";
import { RuntimeTransportContext } from "../../../gui/web/src/runtime/runtime-transport-context.js";

let latestRun: ReturnType<typeof useChatRun> | undefined;
let root: Root;
let container: HTMLDivElement;

function Probe({ onRunError }: { onRunError: (sessionId: string) => void }) {
  latestRun = useChatRun({
    activeSessionId: "session-1",
    setToast: vi.fn(),
    onRunStart: vi.fn(),
    onRunError,
  });
  return null;
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

describe("useChatRun terminal state", () => {
  it("clears the optimistic queued projection when SSE reports a terminal failure", async () => {
    const onRunError = vi.fn();
    const transport = {
      startChatRun: vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"type":"run.failed","error":{"message":"Runtime stopped"}}\n\n',
                  ),
                );
                controller.close();
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
      ),
    };

    await act(async () =>
      root.render(
        React.createElement(
          RuntimeTransportContext.Provider,
          { value: transport },
          React.createElement(Probe, { onRunError }),
        ),
      ),
    );

    await act(async () => latestRun?.startChatRun("Research AAPL"));

    expect(onRunError).toHaveBeenCalledOnce();
    expect(onRunError).toHaveBeenCalledWith("session-1");
    expect(latestRun?.runState).toBe("failed");
  });

  it("retries a stopped run with a fresh action id instead of replaying the stopped one", async () => {
    const startBodies: Array<{ actionId: string }> = [];
    const cancelBodies: Array<{ targetActionId: string }> = [];
    const transport = {
      startChatRun: vi.fn(
        (_sessionId: string, body: { actionId: string }, signal: AbortSignal) =>
          new Promise<Response>((_resolve, reject) => {
            startBodies.push(body);
            signal.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            );
          }),
      ),
      cancelChatRun: vi.fn(async (_sessionId: string, body: { targetActionId: string }) => {
        cancelBodies.push(body);
        return { ok: true, cancelled: true, duplicate: false };
      }),
    };

    await act(async () =>
      root.render(
        React.createElement(
          RuntimeTransportContext.Provider,
          { value: transport },
          React.createElement(Probe, { onRunError: vi.fn() }),
        ),
      ),
    );

    let firstRun: Promise<unknown> | undefined;
    await act(async () => {
      firstRun = latestRun?.startChatRun("Research AAPL");
    });
    await act(async () => latestRun?.stopRun());
    await act(async () => firstRun);
    expect(cancelBodies).toEqual([
      expect.objectContaining({ targetActionId: startBodies[0]?.actionId }),
    ]);

    await act(async () => {
      void latestRun?.retryRun();
    });

    expect(startBodies).toHaveLength(2);
    expect(startBodies[1]?.actionId).toBeTruthy();
    expect(startBodies[1]?.actionId).not.toBe(startBodies[0]?.actionId);
  });
});
