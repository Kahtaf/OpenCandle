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
});
