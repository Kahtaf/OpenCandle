import { describe, expect, it, vi } from "vitest";
import { createHostedRuntimeTransport } from "../../../gui/web/src/runtime/hosted-runtime-transport.js";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

// Minimal typed shape of the serialized messages the transport publishes to a
// subscriber; avoids `any`.
type TransportMessage = {
  type?: string;
  sessionId?: string;
  snapshot?: unknown;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const SESSION_A = "session-a";
const SESSION_B = "session-b";

// Same bootstrap shape the hosted runtime host returns for gui bootstrap /
// load_session / tool_invoke, with one independently identifiable assistant
// message per session.
function bootstrapFor(sessionId: string, answer: string) {
  const messageId = `${sessionId}-assistant`;
  return {
    role: "writer",
    sessionId,
    sessions: [{ id: sessionId, name: sessionId }],
    catalog: { tools: [], workflows: [], providers: [] },
    modelSetup: { requirement: "ready", providers: [], availableModels: [] },
    askUserPrompts: [],
    coordination: { sessionId, status: "ready" },
    snapshot: {
      sessionId,
      entries: [
        {
          type: "message",
          id: messageId,
          message: { role: "assistant", content: answer },
        },
      ],
      events: [
        { type: "message.created", sessionId, messageId, role: "assistant", seq: 1 },
        {
          type: "message.completed",
          sessionId,
          messageId,
          content: [{ type: "text", text: answer }],
          seq: 2,
        },
      ],
      state: {
        watchlist: [],
        activeAnalyses: [],
        recentResearch: [],
        dataQuality: { softGaps: [], hardSkips: [] },
      },
    },
  };
}

describe("hosted runtime transport session isolation", () => {
  it("never publishes a stale bootstrap snapshot for a session that is no longer selected", async () => {
    const bootstrapA = bootstrapFor(SESSION_A, "Session A answer");
    const bootstrapB = bootstrapFor(SESSION_B, "Session B answer");

    // Deferred external boundary: a background refresh's bootstrap can resolve
    // after the transport has already switched to another session.
    const pendingBootstraps: Array<Deferred<unknown>> = [];
    const request = vi.fn((_operation: string, payload: { action?: string }) => {
      if (payload?.action === "bootstrap") {
        const pending = deferred<unknown>();
        pendingBootstraps.push(pending);
        return pending.promise;
      }
      if (payload?.action === "load_session" || payload?.action === "tool_invoke") {
        return Promise.resolve(bootstrapB);
      }
      if (payload?.action === "preferences_list") {
        return Promise.resolve({ preferences: [], toolDefaults: [] });
      }
      return Promise.resolve({});
    });

    const transport = createHostedRuntimeTransport({
      host: {
        request,
        streamRequest: vi.fn(),
        getModelSetup: () => ({ requirement: "ready", providers: [], availableModels: [] }),
        handleCommand: vi.fn(async () => ({})),
      },
    });

    const events: TransportMessage[] = [];
    const preferenceCalls = () =>
      request.mock.calls.filter(([, payload]) => payload?.action === "preferences_list").length;

    const channel = transport.openEventChannel({
      onMessage: (message: string) => events.push(JSON.parse(message) as TransportMessage),
      onClose: vi.fn(),
    });
    expect(channel).toBeTruthy();

    try {
      // Boot on session A.
      await vi.waitFor(() => expect(pendingBootstraps).toHaveLength(1));
      pendingBootstraps[0].resolve(bootstrapA);
      await vi.waitFor(() =>
        expect(stateSnapshots(events).some((event) => event.sessionId === SESSION_A)).toBe(true),
      );

      // Issue a background refresh while A is still selected; it stays pending.
      channel?.send(JSON.stringify({ type: "model.setup.refresh" }));
      await vi.waitFor(() => expect(pendingBootstraps).toHaveLength(2));

      // Public-API session switch to B, then publish B's snapshot as the active
      // one through a direct hosted tool run on B.
      const loaded = await transport.loadSession(SESSION_B);
      expect(loaded).toMatchObject({ sessionId: SESSION_B });
      await transport.invokeTool({
        sessionId: SESSION_B,
        toolName: "get_stock_quote",
        args: { symbol: "AAPL" },
      });
      await vi.waitFor(() => expect(stateSnapshots(events).at(-1)?.sessionId).toBe(SESSION_B));
      const switchedAt = events.length;

      // The stale refresh now resolves with A's bootstrap. B is selected, so A's
      // snapshot must never reach subscribers. Synchronize on a *strictly new*
      // preferences_list request (issued only after publishBootstrap has run),
      // not on any earlier matching call, so the guard decision is known done.
      const preferencesBefore = preferenceCalls();
      pendingBootstraps[1].resolve(bootstrapA);
      await vi.waitFor(() => expect(preferenceCalls()).toBeGreaterThan(preferencesBefore));

      expect(
        events
          .slice(switchedAt)
          .filter((event) => event.type === "state.snapshot" && event.sessionId === SESSION_A),
      ).toEqual([]);

      // Independent expected content: the active snapshot is B's, not A's.
      const activeSnapshot = stateSnapshots(events).at(-1);
      expect(activeSnapshot?.sessionId).toBe(SESSION_B);
      expect(JSON.stringify(activeSnapshot?.snapshot)).toContain("Session B answer");
      expect(JSON.stringify(activeSnapshot?.snapshot)).not.toContain("Session A answer");
    } finally {
      channel?.close();
      transport.dispose();
    }
  });
});

function stateSnapshots(events: TransportMessage[]) {
  return events.filter((event) => event.type === "state.snapshot");
}
