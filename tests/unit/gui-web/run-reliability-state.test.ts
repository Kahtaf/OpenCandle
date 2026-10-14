// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ToolDrawerProvider,
  useToolDrawer,
} from "../../../gui/web/src/features/chat/tool-drawer-context.jsx";
import { useChatRun } from "../../../gui/web/src/hooks/useChatRun.jsx";
import { useGuiConnection } from "../../../gui/web/src/hooks/useGuiConnection.jsx";
import { RuntimeTransportContext } from "../../../gui/web/src/runtime/runtime-transport-context.js";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("restored run ownership", () => {
  it("targets the restored run while a late Stop acknowledgement leaves a newer server run visible", async () => {
    let latest: ReturnType<typeof useChatRun>;
    let confirmStop!: (result: { ok: boolean; cancelled: boolean }) => void;
    const transport = {
      cancelChatRun: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              confirmStop = resolve;
            }),
        )
        .mockResolvedValue({ ok: true, cancelled: true }),
    };
    function Probe({ actionId }: { actionId: string | null }) {
      latest = useChatRun({
        activeSessionId: "session-1",
        sessionSnapshots: {
          "session-1": { activeRun: actionId ? { actionId } : null },
          "session-2": { activeRun: null },
        },
        setToast: vi.fn(),
        onEvent: vi.fn(),
        onRunStart: vi.fn(),
        onRunError: vi.fn(),
      });
      return null;
    }
    const render = (actionId: string | null) =>
      act(async () =>
        root.render(
          React.createElement(
            RuntimeTransportContext.Provider,
            { value: transport },
            React.createElement(Probe, { actionId }),
          ),
        ),
      );
    await render("run-a");
    expect(latest!.runState).toBe("streaming");
    expect(latest!.localRunState).toBe("ready");
    await act(async () => latest!.stopRun());
    expect(transport.cancelChatRun).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ targetActionId: "run-a" }),
    );
    await render("run-b");
    await act(async () => confirmStop({ ok: true, cancelled: true }));
    expect(latest!.runState).toBe("streaming");
    await act(async () => latest!.stopRun());
    expect(transport.cancelChatRun).toHaveBeenLastCalledWith(
      "session-1",
      expect.objectContaining({ targetActionId: "run-b" }),
    );
    expect(latest!.runState).toBe("ready");
    await render("run-c");
    expect(latest!.runState).toBe("streaming");
    await render(null);
    expect(latest!.runState).toBe("ready");
  });
});

describe("connection recovery", () => {
  it("keeps newer run ownership when an ordinary session load finishes late", async () => {
    let latest: ReturnType<typeof useGuiConnection>;
    let onMessage!: (message: string) => void;
    let completeRead!: (data: Record<string, unknown>) => void;
    const transport = {
      kind: "loopback",
      loadSession: vi.fn(
        () =>
          new Promise<Record<string, unknown>>((resolve) => {
            completeRead = resolve;
          }),
      ),
      openEventChannel: (callbacks: { onMessage: (message: string) => void }) => {
        onMessage = callbacks.onMessage;
        return { readyState: 1, close: vi.fn() };
      },
    };
    function Probe() {
      latest = useGuiConnection();
      return null;
    }
    await act(async () =>
      root.render(
        React.createElement(
          RuntimeTransportContext.Provider,
          { value: transport },
          React.createElement(Probe),
        ),
      ),
    );
    await act(async () =>
      onMessage(
        JSON.stringify({
          type: "boot",
          role: "writer",
          sessionId: "current",
          catalog: { tools: [], workflows: [], providers: [] },
        }),
      ),
    );
    let read!: Promise<boolean>;
    await act(async () => {
      read = latest!.loadSession("background");
    });
    await act(async () => {
      onMessage(
        JSON.stringify({
          type: "session.snapshot",
          sessionId: "background",
          activeRun: null,
          entries: [{ type: "message", message: { role: "assistant", content: "Completed" } }],
        }),
      );
      completeRead({
        sessionId: "background",
        snapshot: {
          sessionId: "background",
          activeRun: { actionId: "finished-run" },
          entries: [],
        },
      });
      expect(await read).toBe(true);
    });
    expect(latest!.sessionSnapshots.background.activeRun).toBeNull();
    expect(latest!.sessionSnapshots.background.entries).toHaveLength(1);
    expect(latest!.currentSessionId).toBe("current");
  });

  it.each(["loopback", "hosted"])(
    "reconnects a nominally open %s channel without selecting background chats",
    async (kind) => {
      let latest: ReturnType<typeof useGuiConnection>;
      const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
      const channels: Array<{
        readyState: number;
        close: ReturnType<typeof vi.fn>;
        onMessage: (message: string) => void;
      }> = [];
      let completeStaleRead: ((data: Record<string, unknown>) => void) | undefined;
      const transport = {
        kind,
        loadSession: vi.fn(async (sessionId: string) => {
          if (sessionId === "unavailable") throw new Error("Channel is still recovering");
          if (sessionId === "racing")
            return new Promise<Record<string, unknown>>((resolve) => {
              completeStaleRead = resolve;
            });
          return { sessionId, snapshot: { sessionId, activeRun: null, events: [], entries: [] } };
        }),
        openEventChannel: vi.fn(
          (callbacks: { onMessage: (message: string) => void; onClose: () => void }) => {
            const channel = {
              readyState: 1,
              onMessage: callbacks.onMessage,
              close: vi.fn(() => callbacks.onClose()),
            };
            channels.push(channel);
            return channel;
          },
        ),
      };
      function Probe() {
        latest = useGuiConnection();
        return null;
      }
      await act(async () =>
        root.render(
          React.createElement(
            RuntimeTransportContext.Provider,
            { value: transport },
            React.createElement(Probe),
          ),
        ),
      );
      const boot = JSON.stringify({
        type: "boot",
        role: "writer",
        supportsSessionActions: true,
        sessionId: "session-1",
        catalog: { tools: [], workflows: [], providers: [] },
      });
      await act(async () => channels[0].onMessage(boot));
      expect(latest!.supportsSessionActions).toBe(true);
      await act(async () => {
        for (const sessionId of ["background", "unavailable", "racing"]) {
          channels[0].onMessage(
            JSON.stringify({
              type: "session.snapshot",
              sessionId,
              activeRun: { actionId: "restored-run" },
            }),
          );
        }
      });
      online.mockReturnValue(false);
      await act(async () => {
        window.dispatchEvent(new Event("offline"));
        window.dispatchEvent(new Event("focus"));
      });
      expect(latest!.role).toBe("offline");
      expect(latest!.supportsSessionActions).toBe(false);
      expect(channels).toHaveLength(1);
      online.mockReturnValue(true);
      await act(async () => window.dispatchEvent(new Event("online")));
      expect(channels[0].close).toHaveBeenCalledOnce();
      expect(channels).toHaveLength(2);
      expect(latest!.supportsSessionActions).toBe(false);
      await act(async () => {
        channels[1].onMessage(boot);
        window.dispatchEvent(new Event("focus"));
      });
      expect(latest!.role).toBe("writer");
      expect(latest!.supportsSessionActions).toBe(true);
      if (kind === "loopback") {
        expect(transport.loadSession).toHaveBeenCalledWith("background");
        expect(latest!.sessionSnapshots.background.activeRun).toBeNull();
        await act(async () =>
          channels[1].onMessage(
            JSON.stringify({ type: "session.snapshot", sessionId: "racing", activeRun: null }),
          ),
        );
        expect(completeStaleRead).toBeDefined();
        await act(async () =>
          completeStaleRead!({
            sessionId: "racing",
            snapshot: {
              sessionId: "racing",
              activeRun: { actionId: "restored-run" },
              events: [],
              entries: [],
            },
          }),
        );
        expect(latest!.sessionSnapshots.racing.activeRun).toBeNull();
      } else {
        expect(transport.loadSession).not.toHaveBeenCalled();
        expect(latest!.sessionSnapshots.background.activeRun).toEqual({ actionId: "restored-run" });
      }
      expect(latest!.sessionSnapshots.unavailable.activeRun).toEqual({ actionId: "restored-run" });
      expect(latest!.currentSessionId).toBe("session-1");
      expect(channels).toHaveLength(2);
      for (const activeRun of [{ actionId: "remote-run" }, null]) {
        await act(async () =>
          channels[1].onMessage(
            JSON.stringify({ type: "session.snapshot", sessionId: "session-1", activeRun }),
          ),
        );
        expect(latest!.sessionSnapshots["session-1"].activeRun).toEqual(activeRun);
      }
    },
  );
});

describe("tool details during research", () => {
  it.each([true, false])(
    "keeps mobile controls accessible while allowing manual tool details (mobile: %s)",
    async (mobile) => {
      vi.stubGlobal("matchMedia", () => ({ matches: mobile }));
      let drawer: ReturnType<typeof useToolDrawer>;
      function Probe() {
        drawer = useToolDrawer();
        return null;
      }
      await act(async () =>
        root.render(
          React.createElement(
            ToolDrawerProvider,
            { activeSessionId: "session-1" },
            React.createElement(Probe),
          ),
        ),
      );
      const run = { id: "tool-1", sessionId: "session-1", status: "pending" };
      await act(async () => drawer!.requestAutoOpen({ ...run, sessionId: "background-session" }));
      expect(drawer!.run).toBeNull();
      await act(async () => drawer!.requestAutoOpen(run));
      expect(drawer!.run).toEqual(mobile ? null : run);
      await act(async () => drawer!.open(run));
      expect(drawer!.run).toEqual(run);
      await act(async () => drawer!.close());
      await act(async () => drawer!.requestAutoOpen(run));
      expect(drawer!.run).toBeNull();
    },
  );
});
