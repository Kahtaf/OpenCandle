import { describe, expect, it, vi } from "vitest";
import {
  buildGuiToastPayload,
  buildHttpFallbackMessageRequest,
  rejectTimedOutToolInvoke,
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
});
