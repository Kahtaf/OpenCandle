import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applySocketErrorFrame,
  buildGuiToastPayload,
  buildHttpFallbackMessageRequest,
  buildSessionActionSocketMessage,
  buildToolInvokeHttpFallbackRequest,
  buildToolInvokeSocketMessage,
  mergeSessionSnapshotMap,
  rejectTimedOutToolInvoke,
  resolveBootstrapRole,
  resolveBootstrapSessionId,
  resolveEventChannelBootTimeout,
  resolveSnapshotCoordination,
  resolveSupportsSessionActions,
  resolveToolInvokeTimeout,
  resolveWritableRole,
  sessionSnapshotFromPayload,
  settlePendingToolInvoke,
  shouldReconnectOnForeground,
  TOOL_INVOKE_TIMEOUT_MESSAGE,
} from "../../../gui/web/src/hooks/useGuiConnection.jsx";
import { subscribeSessionActionErrors } from "../../../gui/web/src/lib/session-action-errors.js";
import {
  addressModelCommand,
  markSessionModelsStale,
  modelAvailabilitySignature,
  resolveVisibleModelSetup,
  staleSessionModelToReload,
  trackModelAvailability,
} from "../../../gui/web/src/lib/session-model-setup.js";

describe("useGuiConnection helpers", () => {
  it("reports a socket error frame to the request that caused it, then toasts it", () => {
    const failed: string[] = [];
    const unsubscribe = subscribeSessionActionErrors((actionId) => failed.push(actionId));
    const setToast = vi.fn();
    const setModelSetupError = vi.fn();
    try {
      const pending = applySocketErrorFrame(
        { type: "error", actionId: "ask-user-answer-1", message: "Unknown or resolved question" },
        { pendingModelKeySaveActionId: "", setModelSetupError, setToast },
      );
      expect(failed).toEqual(["ask-user-answer-1"]);
      expect(setToast).toHaveBeenCalledWith("Unknown or resolved question", { destructive: true });
      expect(setModelSetupError).not.toHaveBeenCalled();
      expect(pending).toBe("");
    } finally {
      unsubscribe();
    }
  });

  it("renders the in-flight key save's failure inline and clears it", () => {
    const setToast = vi.fn();
    const setModelSetupError = vi.fn();
    const pending = applySocketErrorFrame(
      { type: "error", actionId: "save-1", message: "Key check failed" },
      { pendingModelKeySaveActionId: "save-1", setModelSetupError, setToast },
    );
    expect(setModelSetupError).toHaveBeenCalledWith("Key check failed");
    expect(setToast).not.toHaveBeenCalled();
    expect(pending).toBe("");
    expect(
      applySocketErrorFrame(
        { type: "error", actionId: "other", message: "boom" },
        { pendingModelKeySaveActionId: "save-1", setModelSetupError, setToast },
      ),
    ).toBe("save-1");
  });

  it("allows hosted mutations time for durable browser checkpoints", () => {
    expect(resolveToolInvokeTimeout("hosted")).toBe(120_000);
    expect(resolveToolInvokeTimeout("loopback")).toBe(30_000);
  });

  it("allows the hosted event channel to finish booting its WebContainer", () => {
    expect(resolveEventChannelBootTimeout("hosted")).toBe(120_000);
    expect(resolveEventChannelBootTimeout("loopback")).toBe(1_500);
  });

  it("lets a hosted follower use the shared writer while preserving offline read-only state", () => {
    expect(resolveWritableRole("follower", { writable: true })).toBe("writer");
    expect(resolveWritableRole("follower", { writable: false })).toBe("follower");
    expect(resolveWritableRole("offline", { writable: false })).toBe("offline");
  });

  it("disables session actions whenever the runtime is offline or explicitly read-only", () => {
    expect(resolveSupportsSessionActions(true, "offline", { writable: false })).toBe(false);
    expect(resolveSupportsSessionActions(false, "writer", { writable: true })).toBe(false);
    expect(resolveSupportsSessionActions(true, "follower", { writable: true })).toBe(true);
  });

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

  it("builds trusted HTTP fallback requests for tool invocation", () => {
    const request = buildToolInvokeHttpFallbackRequest(
      "manage_watchlist",
      { action: "create", watchlist_name: "MAG7" },
      "session-visible",
      "",
      { recordTranscript: false },
    );

    expect(request.path).toBe("/api/tool-invoke");
    expect(request.body).toMatchObject({
      sessionId: "session-visible",
      toolName: "manage_watchlist",
      args: { action: "create", watchlist_name: "MAG7" },
      recordTranscript: false,
    });
    expect(request.body.actionId).toMatch(/^tool-/);

    expect(() => buildToolInvokeHttpFallbackRequest("manage_watchlist", {}, "")).toThrow(
      "sessionId is required",
    );
  });

  it("refreshes coordination from state snapshots for the tracked session", () => {
    const tuiOwned = { sessionId: "session-1", status: "syncing", ownerKind: "tui" };
    const guiOwned = { sessionId: "session-1", status: "ready", ownerKind: "gui" };
    const routed = { sessionId: "session-routed", status: "syncing", ownerKind: "tui" };

    // Mid-run ownership changes for the tracked session must reach the gate.
    expect(resolveSnapshotCoordination(guiOwned, tuiOwned)).toEqual(tuiOwned);
    expect(resolveSnapshotCoordination(null, tuiOwned)).toEqual(tuiOwned);
    // A snapshot for the server's current session must not clobber the
    // coordination bootstrapped for a different routed session.
    expect(resolveSnapshotCoordination(routed, guiOwned)).toEqual(routed);
    // Snapshots without coordination (older servers) leave the state alone.
    expect(resolveSnapshotCoordination(guiOwned, undefined)).toEqual(guiOwned);
  });

  it("stamps direct tool invocation socket messages with the visible session id", () => {
    expect(
      buildToolInvokeSocketMessage(
        {
          requestId: "req-1",
          actionId: "tool-action-1",
          toolName: "get_stock_quote",
          args: { symbol: "NVDA" },
        },
        "session-visible",
      ),
    ).toEqual({
      type: "tool.invoke",
      requestId: "req-1",
      actionId: "tool-action-1",
      sessionId: "session-visible",
      toolName: "get_stock_quote",
      args: { symbol: "NVDA" },
    });

    expect(
      buildToolInvokeSocketMessage(
        { requestId: "req-2", toolName: "get_stock_quote", args: { symbol: "AMD" } },
        "session-from-state-snapshot",
        "session-visible-route",
      ),
    ).toMatchObject({
      requestId: "req-2",
      sessionId: "session-visible-route",
    });

    expect(() =>
      buildToolInvokeSocketMessage(
        { requestId: "req-3", toolName: "get_stock_quote", args: { symbol: "MSFT" } },
        "",
      ),
    ).toThrow("sessionId is required");
  });

  it("stamps ask_user socket messages with action ids and session ids", () => {
    expect(
      buildSessionActionSocketMessage(
        "ask_user.answer",
        { id: "ask-1", answer: "Yes", actionId: "ask-action-1" },
        "session-visible",
      ),
    ).toEqual({
      type: "ask_user.answer",
      id: "ask-1",
      answer: "Yes",
      actionId: "ask-action-1",
      sessionId: "session-visible",
    });
    expect(
      buildSessionActionSocketMessage(
        "ask_user.answer",
        { id: "ask-2", answer: "No", actionId: "ask-action-2", sessionId: "prompt-session" },
        "current-session",
      ),
    ).toMatchObject({
      actionId: "ask-action-2",
      sessionId: "prompt-session",
    });
    expect(() => buildSessionActionSocketMessage("ask_user.cancel", { id: "ask-3" }, "")).toThrow(
      "sessionId is required",
    );
  });

  it("allows global model setup commands before a session bootstrap completes", () => {
    expect(
      buildSessionActionSocketMessage(
        "model.setup.save_api_key",
        { provider: "openai", apiKey: "test-key", storageMode: "session" },
        "",
      ),
    ).toMatchObject({
      type: "model.setup.save_api_key",
      provider: "openai",
      apiKey: "test-key",
      storageMode: "session",
    });
  });

  it("does not send legacy active-session chat prompts from browser call sites", () => {
    const source = readSourceTree(resolve("gui/web/src"));

    expect(source).not.toContain("chat.prompt");
  });

  it("preserves the global writer role while loading a follower historical session", () => {
    expect(resolveBootstrapRole("writer", { role: "follower" }, false)).toBe("writer");
    expect(resolveBootstrapRole("writer", { role: "follower" })).toBe("follower");
  });

  it("preserves the active writer session id while loading a historical route snapshot", () => {
    expect(resolveBootstrapSessionId("writer-session", "historical-session", false)).toBe(
      "writer-session",
    );
    expect(resolveBootstrapSessionId("writer-session", "new-session")).toBe("new-session");
  });

  it("reconnects on foreground only when the socket is not already active", () => {
    expect(shouldReconnectOnForeground({ documentVisibility: "visible", readyState: 3 })).toBe(
      true,
    );
    expect(
      shouldReconnectOnForeground({ documentVisibility: "visible", readyState: undefined }),
    ).toBe(true);
    expect(shouldReconnectOnForeground({ documentVisibility: "visible", readyState: 1 })).toBe(
      false,
    );
    expect(shouldReconnectOnForeground({ documentVisibility: "visible", readyState: 0 })).toBe(
      false,
    );
    expect(shouldReconnectOnForeground({ documentVisibility: "hidden", readyState: 3 })).toBe(
      false,
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

  describe("per-session model (issue #217)", () => {
    it("keeps each session's model in its snapshot", () => {
      const afterA = mergeSessionSnapshotMap(
        {},
        {
          type: "state.snapshot",
          sessionId: "session-a",
          sessionModel: { currentModel: "google/gemini-2.5-flash" },
        },
      );
      const afterB = mergeSessionSnapshotMap(afterA, {
        type: "session.snapshot",
        sessionId: "session-b",
        sessionModel: { currentModel: "openai/gpt-6-luna", currentThinkingLevel: "high" },
      });
      // A payload without a model keeps the one already known for the session.
      const afterA2 = mergeSessionSnapshotMap(afterB, {
        type: "session.snapshot",
        sessionId: "session-a",
        entries: [{ id: "entry-a" }],
      });

      expect(afterA2["session-a"]?.sessionModel).toEqual({
        currentModel: "google/gemini-2.5-flash",
      });
      expect(afterA2["session-b"]?.sessionModel).toEqual({
        currentModel: "openai/gpt-6-luna",
        currentThinkingLevel: "high",
      });
    });

    it("shows the visible session's model over the server's current session", () => {
      const global = {
        requirement: "ready",
        currentModel: "google/gemini-2.5-flash",
        currentThinkingLevel: "off",
        availableThinkingLevels: ["off"],
        availableModels: [
          { provider: "google", id: "gemini-2.5-flash" },
          { provider: "openai", id: "gpt-6-luna" },
        ],
        providers: [],
      };

      expect(
        resolveVisibleModelSetup(global, {
          currentModel: "openai/gpt-6-luna",
          currentThinkingLevel: "high",
          availableThinkingLevels: ["off", "low", "high"],
        }),
      ).toMatchObject({
        requirement: "ready",
        currentModel: "openai/gpt-6-luna",
        currentThinkingLevel: "high",
        availableThinkingLevels: ["off", "low", "high"],
        availableModels: global.availableModels,
      });
      expect(resolveVisibleModelSetup(global, undefined)).toBe(global);
      expect(resolveVisibleModelSetup(global, {})).toMatchObject({
        requirement: "select_model",
        currentModel: undefined,
      });
    });

    it("marks cached session models stale when the available models change", () => {
      const before = modelAvailabilitySignature({
        availableModels: [{ provider: "google", id: "gemini-2.5-flash" }],
      });
      const after = modelAvailabilitySignature({
        availableModels: [
          { provider: "google", id: "gemini-2.5-flash" },
          { provider: "openai", id: "gpt-6-luna" },
        ],
      });
      expect(before).not.toBe(after);

      const snapshots = {
        "session-a": { sessionId: "session-a", sessionModel: { currentModel: "google/x" } },
        "session-h": { sessionId: "session-h" },
      };
      const stale = markSessionModelsStale(snapshots);
      expect(stale["session-a"]).toMatchObject({ sessionModelStale: true });
      // Snapshots without a per-session model (hosted) are left alone.
      expect(stale["session-h"]).toBe(snapshots["session-h"]);
      // A fresh snapshot for the session clears the flag.
      const refreshed = mergeSessionSnapshotMap(stale, {
        type: "session.snapshot",
        sessionId: "session-a",
        sessionModel: { currentModel: "openai/gpt-6-luna" },
      });
      expect(refreshed["session-a"]?.sessionModelStale).toBeUndefined();
    });

    it("addresses model commands to the visible session", () => {
      expect(addressModelCommand("model.setup.select_model", { modelId: "m" }, "b")).toEqual({
        modelId: "m",
        sessionId: "b",
      });
      expect(addressModelCommand("model.setup.set_thinking", { level: "high" }, "b")).toEqual({
        level: "high",
        sessionId: "b",
      });
      expect(addressModelCommand("model.setup.save_api_key", undefined, "b")).toEqual({
        sessionId: "b",
      });
      // An explicit session, another command, or no visible session is left alone.
      expect(addressModelCommand("model.setup.select_model", { sessionId: "a" }, "b")).toEqual({
        sessionId: "a",
      });
      expect(addressModelCommand("session.rename", { name: "x" }, "b")).toEqual({ name: "x" });
      expect(addressModelCommand("model.setup.select_model", { modelId: "m" }, "")).toEqual({
        modelId: "m",
      });
    });

    it("reports a change in the models with keys once a baseline exists", () => {
      const ref = { current: null };
      const one = { availableModels: [{ provider: "google", id: "a" }] };
      const two = {
        availableModels: [
          { provider: "google", id: "a" },
          { provider: "x", id: "b" },
        ],
      };

      expect(trackModelAvailability(ref, one)).toBe(false);
      expect(trackModelAvailability(ref, one)).toBe(false);
      expect(trackModelAvailability(ref, two)).toBe(true);
      expect(trackModelAvailability(ref, two)).toBe(false);
      // A payload without model setup (e.g. an error body) is ignored.
      expect(trackModelAvailability(ref, undefined)).toBe(false);
      expect(trackModelAvailability(ref, two)).toBe(false);
    });

    it("reloads only a visible session whose model went stale", () => {
      expect(staleSessionModelToReload({ sessionModelStale: true }, "b")).toBe("b");
      expect(staleSessionModelToReload({ sessionModelStale: true }, "")).toBe("");
      expect(staleSessionModelToReload({ sessionModel: {} }, "b")).toBe("");
      expect(staleSessionModelToReload(null, "b")).toBe("");
    });

    it("addresses HTTP fallback model changes to the visible session", () => {
      expect(
        buildHttpFallbackMessageRequest("model.setup.select_model", {
          provider: "openai",
          modelId: "gpt-6-luna",
          sessionId: "session-b",
        }),
      ).toEqual({
        path: "/api/model-setup/model",
        body: { provider: "openai", modelId: "gpt-6-luna", sessionId: "session-b" },
      });
      expect(
        buildHttpFallbackMessageRequest("model.setup.set_thinking", {
          level: "high",
          sessionId: "session-b",
        }),
      ).toEqual({
        path: "/api/model-setup/thinking",
        body: { level: "high", sessionId: "session-b" },
      });
      expect(
        buildHttpFallbackMessageRequest("model.setup.save_api_key", {
          provider: "google",
          apiKey: "gem-key",
          sessionId: "session-b",
        }),
      ).toEqual({
        path: "/api/model-setup/api-key",
        body: { provider: "google", apiKey: "gem-key", sessionId: "session-b" },
      });
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
      type: "session.snapshot",
      sessionId: "session-b",
      entries: [{ id: "entry-b" }],
      events: [{ type: "message.completed", seq: 1 }],
    });

    expect(afterB["session-a"]?.entries).toEqual([{ id: "entry-a" }]);
    expect(afterB["session-b"]?.entries).toEqual([{ id: "entry-b" }]);
  });
});

function readSourceTree(root: string): string {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return [readSourceTree(path)];
      if (!/\.(js|jsx|ts|tsx)$/.test(entry.name)) return [];
      return [readFileSync(path, "utf-8")];
    })
    .join("\n");
}
