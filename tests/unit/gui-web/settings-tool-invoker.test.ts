// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsToolInvoker } from "../../../gui/web/src/features/settings/use-settings-tool-invoker.js";
import { RuntimeTransportProvider } from "../../../gui/web/src/runtime/runtime-transport-provider.jsx";

let container: HTMLDivElement;
let root: Root;
let latestInvoker: ((toolName: string, args?: Record<string, unknown>) => Promise<unknown>) | null;

function Probe() {
  latestInvoker = useSettingsToolInvoker();
  return null;
}

function renderWithTransport(transport: Record<string, unknown>) {
  act(() => {
    root.render(
      React.createElement(RuntimeTransportProvider, { transport }, React.createElement(Probe)),
    );
  });
}

function makeTransport(coordination: Record<string, unknown> | undefined) {
  return {
    kind: "loopback",
    bootstrap: vi.fn(async () => ({
      sessionId: "session-1",
      coordination,
    })),
    invokeTool: vi.fn(async () => ({ ok: true })),
  };
}

describe("useSettingsToolInvoker", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    latestInvoker = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("invokes the tool for a writable session without recording a transcript", async () => {
    const transport = makeTransport({ sessionId: "session-1", ownerKind: "gui", writable: true });
    renderWithTransport(transport);
    await expect(
      latestInvoker?.("daily_watchlist_report", { action: "configure" }),
    ).resolves.toEqual({ ok: true });
    expect(transport.invokeTool).toHaveBeenCalledTimes(1);
    const body = (transport.invokeTool as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(body.recordTranscript).toBe(false);
  });

  it("rejects without invoking when the session is owned by the TUI", async () => {
    const transport = makeTransport({ sessionId: "session-1", ownerKind: "tui", writable: true });
    renderWithTransport(transport);
    await expect(latestInvoker?.("daily_watchlist_report", {})).rejects.toThrow(
      "OpenCandle is reconnecting to this session.",
    );
    expect(transport.invokeTool).not.toHaveBeenCalled();
  });

  it("rejects without invoking when coordination reports the session is not writable", async () => {
    const transport = makeTransport({ sessionId: "session-1", ownerKind: "gui", writable: false });
    renderWithTransport(transport);
    await expect(latestInvoker?.("daily_watchlist_report", {})).rejects.toThrow(
      "OpenCandle is reconnecting to this session.",
    );
    expect(transport.invokeTool).not.toHaveBeenCalled();
  });
});
