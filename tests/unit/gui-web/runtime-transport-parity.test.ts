import { describe, expect, it, vi } from "vitest";
import { reduceChatEvents } from "../../../gui/shared/event-reducer.js";
import { createHostedRuntimeTransport } from "../../../gui/web/src/runtime/hosted-runtime-transport.js";
import { createLoopbackRuntimeTransport } from "../../../gui/web/src/runtime/runtime-transport.js";

const EVENTS = [
  { type: "run.started", sessionId: "session-1", runId: "run-1", seq: 1 },
  { type: "message.created", sessionId: "session-1", messageId: "m1", role: "assistant", seq: 2 },
  {
    type: "message.completed",
    sessionId: "session-1",
    messageId: "m1",
    content: [{ type: "text", text: "Evidence-backed answer" }],
    seq: 3,
  },
  { type: "run.completed", sessionId: "session-1", runId: "run-1", seq: 4 },
] as const;

describe("runtime transport ChatEvent parity", () => {
  it("feeds equivalent canonical reducer state from local and hosted streaming runs", async () => {
    const local = createLoopbackRuntimeTransport({
      fetchImpl: vi.fn(async () => sseResponse(EVENTS)),
      WebSocketImpl: undefined,
      location: { protocol: "http:", host: "127.0.0.1" },
    });
    const hosted = createHostedRuntimeTransport({
      host: {
        request: vi.fn(),
        streamRequest: vi.fn(async () => sseResponse(EVENTS)),
        getModelSetup: () => ({ requirement: "ready" }),
      },
    });

    const [localEvents, hostedEvents] = await Promise.all([
      local.startChatRun("session-1", {}, undefined).then(readSse),
      hosted.startChatRun("session-1", {}, undefined).then(readSse),
    ]);

    expect(reduceChatEvents(hostedEvents as never)).toEqual(reduceChatEvents(localEvents as never));
  });
});

function sseResponse(events: readonly unknown[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

async function readSse(response: Response): Promise<unknown[]> {
  return (await response.text())
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => JSON.parse(chunk.replace(/^data: /, "")));
}
