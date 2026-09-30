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
  it("retries a stopped turn with a fresh action id even after a completed retry kept its id", async () => {
    const startBodies: Array<{ actionId: string }> = [];
    const transport = {
      startChatRun: vi.fn(async (_sessionId: string, body: { actionId: string }) => {
        startBodies.push(body);
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"type":"run.completed"}\n\n'));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
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

    await act(async () => latestRun?.startChatRun("Research AAPL"));
    expect(latestRun?.runState).toBe("ready");

    await act(async () => {
      void latestRun?.retryRun(undefined, { freshActionId: true });
    });

    expect(startBodies).toHaveLength(2);
    expect(startBodies[1]?.actionId).toBeTruthy();
    expect(startBodies[1]?.actionId).not.toBe(startBodies[0]?.actionId);
  });

  describe("starting right after Stop while the server is still releasing the session", () => {
    const toasts: string[] = [];
    function ToastProbe() {
      latestRun = useChatRun({
        activeSessionId: "session-1",
        setToast: (message: string) => {
          if (message) toasts.push(message);
        },
        onRunStart: vi.fn(),
        onRunError: vi.fn(),
      });
      return null;
    }
    const busy = () =>
      new Response(
        JSON.stringify({ error: "Session already has an active run", code: "session_busy" }),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    const completed = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"type":"run.completed"}\n\n'));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );

    async function renderWith(transport: unknown) {
      toasts.length = 0;
      await act(async () =>
        root.render(
          React.createElement(
            RuntimeTransportContext.Provider,
            { value: transport },
            React.createElement(ToastProbe),
          ),
        ),
      );
    }

    it("waits for the stopped run to release the session, then starts the retry", async () => {
      const startBodies: Array<{ actionId: string }> = [];
      let call = 0;
      const transport = {
        startChatRun: vi.fn(
          async (_sessionId: string, body: { actionId: string }, signal: AbortSignal) => {
            startBodies.push(body);
            call += 1;
            if (call === 1) {
              return new Promise<Response>((_resolve, reject) => {
                signal.addEventListener("abort", () =>
                  reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
                );
              });
            }
            return call === 2 ? busy() : completed();
          },
        ),
        cancelChatRun: vi.fn(async () => ({ ok: true, cancelled: true, duplicate: false })),
      };
      await renderWith(transport);

      let firstRun: Promise<unknown> | undefined;
      await act(async () => {
        firstRun = latestRun?.startChatRun("Compare AAPL and MSFT");
      });
      await act(async () => latestRun?.stopRun());
      await act(async () => firstRun);
      toasts.length = 0;

      let retry: Promise<unknown> | undefined;
      await act(async () => {
        retry = latestRun?.startChatRun("Compare AAPL and MSFT");
      });
      // Busy is not an error while the stopped run winds down.
      expect(latestRun?.runState).toBe("connecting");
      await act(async () => retry);

      expect(transport.startChatRun).toHaveBeenCalledTimes(3);
      expect(startBodies[2]?.actionId).toBe(startBodies[1]?.actionId);
      expect(latestRun?.runState).toBe("ready");
      expect(toasts).toEqual([]);
    });

    it("still reports a busy session that this tab did not just stop", async () => {
      const transport = { startChatRun: vi.fn(async () => busy()) };
      await renderWith(transport);

      await act(async () => latestRun?.startChatRun("Research AAPL"));

      expect(transport.startChatRun).toHaveBeenCalledTimes(1);
      expect(latestRun?.runState).toBe("failed");
      expect(toasts).toEqual(["Session already has an active run"]);
    });
  });
});
