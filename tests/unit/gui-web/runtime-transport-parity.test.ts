import { describe, expect, it, vi } from "vitest";
import { reduceChatEvents } from "../../../gui/shared/event-reducer.js";
import { createHostedRuntimeTransport } from "../../../gui/web/src/runtime/hosted-runtime-transport.js";
import { createLoopbackRuntimeTransport } from "../../../gui/web/src/runtime/runtime-transport.js";

// A session id that needs URL encoding forces the loopback transport to prove
// it targets the requested session instead of a hardcoded or ambient one.
const SESSION_ID = "session/one";
const RUN_ID = "run-1";
const MESSAGE_ID = "m1";
const ANSWER = "Evidence-backed answer";

const EVENTS = [
  { type: "run.started", sessionId: SESSION_ID, runId: RUN_ID, seq: 1 },
  {
    type: "message.created",
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    role: "assistant",
    seq: 2,
  },
  {
    type: "message.completed",
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    content: [{ type: "text", text: ANSWER }],
    seq: 3,
  },
  { type: "run.completed", sessionId: SESSION_ID, runId: RUN_ID, seq: 4 },
] as const;

describe("runtime transport ChatEvent parity", () => {
  it("feeds equivalent, concrete canonical reducer state from local and hosted runs and targets the requested session", async () => {
    const localFetch = vi.fn(async () => sseResponse(EVENTS));
    const local = createLoopbackRuntimeTransport({
      fetchImpl: localFetch,
      WebSocketImpl: undefined,
      location: { protocol: "http:", host: "127.0.0.1" },
    });

    const hostedStreamRequest = vi.fn(async () => sseResponse(EVENTS));
    const hostedRequest = vi.fn(async (_operation: string, payload: { action?: string }) =>
      payload?.action === "preferences_list"
        ? { preferences: [], toolDefaults: [] }
        : {
            role: "writer",
            sessionId: SESSION_ID,
            sessions: [],
            catalog: { tools: [], workflows: [], providers: [] },
            modelSetup: { requirement: "ready", providers: [], availableModels: [] },
            askUserPrompts: [],
            coordination: { sessionId: SESSION_ID, status: "ready" },
            snapshot: { sessionId: SESSION_ID, entries: [], events: [], state: {} },
          },
    );
    const hosted = createHostedRuntimeTransport({
      host: {
        request: hostedRequest,
        streamRequest: hostedStreamRequest,
        getModelSetup: () => ({ requirement: "ready" }),
      },
    });

    const [localEvents, hostedEvents] = await Promise.all([
      local.startChatRun(SESSION_ID, {}, undefined).then(readSse),
      hosted.startChatRun(SESSION_ID, {}, undefined).then(readSse),
    ]);

    // Each transport's external boundary must receive the requested session,
    // so a transport that ignores its session argument fails here.
    expect(localFetch).toHaveBeenCalledWith(
      `/api/sessions/${encodeURIComponent(SESSION_ID)}/runs`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(hostedStreamRequest).toHaveBeenCalledWith(
      "gui",
      expect.objectContaining({ action: "chat_run", sessionId: SESSION_ID }),
      expect.objectContaining({ signal: undefined }),
    );

    const localState = reduceChatEvents(localEvents as never);
    const hostedState = reduceChatEvents(hostedEvents as never);

    // Independent expectations: a reducer that produced empty state, the wrong
    // role, an unfinished message, an unfinished run, or the wrong session
    // fails here regardless of the parity comparison below.
    for (const [label, state] of [
      ["local", localState],
      ["hosted", hostedState],
    ] as const) {
      expect(state.messages, label).toHaveLength(1);
      expect(state.messages[0], label).toMatchObject({
        id: MESSAGE_ID,
        sessionId: SESSION_ID,
        role: "assistant",
        status: "completed",
        text: ANSWER,
      });
      expect(state.session, label).toEqual({ id: SESSION_ID });
      expect([...state.runs.values()], label).toEqual([
        { id: RUN_ID, sessionId: SESSION_ID, status: "completed" },
      ]);
      expect(state.gaps, label).toEqual([]);
      expect(state.lastSeq, label).toBe(4);
    }

    // Retained parity check: both transports feed the same canonical shape.
    expect(hostedState).toEqual(localState);
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
