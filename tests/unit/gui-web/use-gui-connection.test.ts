import { describe, expect, it, vi } from "vitest";
import {
  buildGuiToastPayload,
  buildHttpFallbackMessageRequest,
  mergeSessionSnapshotMap,
  rejectTimedOutToolInvoke,
  sessionSnapshotFromPayload,
  settlePendingToolInvoke,
  TOOL_INVOKE_TIMEOUT_MESSAGE,
} from "../../../gui/web/src/hooks/useGuiConnection.jsx";

describe("useGuiConnection helpers", () => {
  it("treats empty toast messages as a no-op payload", () => {
    expect(buildGuiToastPayload("")).toBeNull();
    expect(buildGuiToastPayload(null)).toBeNull();

    expect(buildGuiToastPayload("Saved", { title: "Done" })).toEqual({
      title: "Done",
      description: "Saved",
      variant: "default",
    });
  });

  it("rejects timed-out invokes without removing the pending entry", () => {
    const reject = vi.fn();
    const pendingInvokes = new Map([["req-1", { resolve: vi.fn(), reject, timeout: 123 }]]);

    expect(rejectTimedOutToolInvoke(pendingInvokes, "req-1")).toBe(true);

    expect(pendingInvokes.has("req-1")).toBe(true);
    expect(reject).toHaveBeenCalledWith(new Error(TOOL_INVOKE_TIMEOUT_MESSAGE));
  });

  it("lets late invoke acknowledgements clear timed-out pending entries", () => {
    const resolve = vi.fn();
    const pendingInvokes = new Map([["req-1", { resolve, reject: vi.fn(), timeout: 123 }]]);

    rejectTimedOutToolInvoke(pendingInvokes, "req-1");

    expect(settlePendingToolInvoke(pendingInvokes, "req-1", "resolve", { ok: true })).toBe(true);
    expect(pendingInvokes.has("req-1")).toBe(false);
    expect(resolve).toHaveBeenCalledWith({ ok: true });
  });

  it("maps model setup messages to trusted HTTP fallback requests", () => {
    expect(
      buildHttpFallbackMessageRequest("model.setup.save_api_key", {
        provider: "google",
        apiKey: "gem-key",
      }),
    ).toEqual({
      path: "/api/model-setup/api-key",
      body: { provider: "google", apiKey: "gem-key" },
    });

    expect(
      buildHttpFallbackMessageRequest("model.setup.select_model", {
        provider: "openai",
        modelId: "gpt-5-mini",
      }),
    ).toEqual({
      path: "/api/model-setup/model",
      body: { provider: "openai", modelId: "gpt-5-mini" },
    });

    expect(buildHttpFallbackMessageRequest("model.setup.refresh")).toEqual({
      path: "/api/model-setup/refresh",
      body: {},
    });
    expect(
      buildHttpFallbackMessageRequest("provider.save_api_key", {
        providerId: "fred",
        apiKey: "fred-key",
      }),
    ).toEqual({
      path: "/api/provider-setup/api-key",
      body: { providerId: "fred", apiKey: "fred-key" },
    });
    expect(buildHttpFallbackMessageRequest("tool.invoke", { toolName: "get_stock_quote" })).toBe(
      null,
    );
  });

  it("normalizes bootstrap and state snapshot payloads into session snapshots", () => {
    expect(
      sessionSnapshotFromPayload({
        sessionId: "session-a",
        snapshot: {
          entries: [{ id: "entry-a" }],
          events: [{ type: "message.completed", seq: 1 }],
          state: { watchlist: [{ symbol: "AAPL" }] },
        },
      }),
    ).toMatchObject({
      sessionId: "session-a",
      entries: [{ id: "entry-a" }],
      events: [{ type: "message.completed", seq: 1 }],
      dashboard: { watchlist: [{ symbol: "AAPL" }] },
    });

    expect(
      sessionSnapshotFromPayload({
        type: "state.snapshot",
        sessionId: "session-b",
        entries: [{ id: "entry-b" }],
        events: [{ type: "message.completed", seq: 2 }],
        state: { watchlist: [{ symbol: "MSFT" }] },
      }),
    ).toMatchObject({
      sessionId: "session-b",
      entries: [{ id: "entry-b" }],
      events: [{ type: "message.completed", seq: 2 }],
      dashboard: { watchlist: [{ symbol: "MSFT" }] },
    });
  });

  it("keeps snapshots keyed by session so late updates cannot replace another route", () => {
    const afterA = mergeSessionSnapshotMap(
      {},
      {
        type: "state.snapshot",
        sessionId: "session-a",
        entries: [{ id: "entry-a" }],
        events: [{ type: "message.completed", seq: 1 }],
      },
    );
    const afterB = mergeSessionSnapshotMap(afterA, {
      type: "state.snapshot",
      sessionId: "session-b",
      entries: [{ id: "entry-b" }],
      events: [{ type: "message.completed", seq: 1 }],
    });

    expect(afterB["session-a"]?.entries).toEqual([{ id: "entry-a" }]);
    expect(afterB["session-b"]?.entries).toEqual([{ id: "entry-b" }]);
  });
});
