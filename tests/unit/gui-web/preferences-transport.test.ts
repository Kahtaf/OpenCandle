import { describe, expect, it, vi } from "vitest";
import { createHostedRuntimeTransport } from "../../../gui/web/src/runtime/hosted-runtime-transport.js";
import { createLoopbackRuntimeTransport } from "../../../gui/web/src/runtime/runtime-transport.js";

const SNAPSHOT = {
  preferences: [
    {
      namespace: "global",
      key: "risk_profile",
      value: "balanced",
      source: "explicit",
      confidence: "high",
      updatedAt: "2026-08-01T10:00:00.000Z",
    },
  ],
  toolDefaults: [
    {
      toolName: "get_stock_history",
      paramPath: "range",
      value: "6mo",
      setAt: "2026-08-01T10:00:00.000Z",
    },
  ],
};

describe("preferences over the local transport", () => {
  it("reads the list from the guarded route", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(SNAPSHOT));
    const transport = createLoopbackRuntimeTransport({ fetchImpl, WebSocketImpl: undefined });

    await expect(transport.getPreferences()).resolves.toEqual(SNAPSHOT);
    expect(fetchImpl).toHaveBeenCalledWith("/api/preferences");
  });

  it("posts each delete to its own route and returns the refreshed list", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ preferences: [], toolDefaults: [] }));
    const transport = createLoopbackRuntimeTransport({ fetchImpl, WebSocketImpl: undefined });

    await expect(
      transport.deletePreference({ namespace: "global", key: "risk_profile" }),
    ).resolves.toEqual({ preferences: [], toolDefaults: [] });
    expect(fetchImpl).toHaveBeenLastCalledWith("/api/preferences/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ namespace: "global", key: "risk_profile" }),
    });

    await transport.deleteToolDefault({ toolName: "get_stock_history", paramPath: "range" });
    expect(fetchImpl).toHaveBeenLastCalledWith("/api/tool-defaults/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolName: "get_stock_history", paramPath: "range" }),
    });
  });
});

describe("preferences over the hosted transport", () => {
  it("reads the list as a runtime read and deletes through the command path", async () => {
    const request = vi.fn(async () => SNAPSHOT);
    const handleCommand = vi.fn(async () => ({ preferences: [], toolDefaults: [] }));
    const transport = createHostedRuntimeTransport({
      host: { request, streamRequest: vi.fn(), handleCommand, getModelSetup: () => ({}) },
    });

    await expect(transport.getPreferences()).resolves.toEqual(SNAPSHOT);
    expect(request).toHaveBeenCalledWith(
      "gui",
      { action: "preferences_list" },
      { signal: undefined },
    );

    await expect(
      transport.deletePreference({ namespace: "global", key: "risk_profile" }),
    ).resolves.toEqual({ preferences: [], toolDefaults: [] });
    expect(handleCommand).toHaveBeenLastCalledWith({
      type: "preferences.delete",
      namespace: "global",
      key: "risk_profile",
    });

    await transport.deleteToolDefault({ toolName: "get_stock_history", paramPath: "range" });
    expect(handleCommand).toHaveBeenLastCalledWith({
      type: "tool_defaults.delete",
      toolName: "get_stock_history",
      paramPath: "range",
    });
  });

  it("offers the same preference surface as the local transport", () => {
    const hosted = createHostedRuntimeTransport({
      host: { request: vi.fn(), streamRequest: vi.fn(), handleCommand: vi.fn() },
    });
    const local = createLoopbackRuntimeTransport({
      fetchImpl: vi.fn(),
      WebSocketImpl: undefined,
    });

    for (const method of ["getPreferences", "deletePreference", "deleteToolDefault"]) {
      expect(typeof hosted[method]).toBe("function");
      expect(typeof local[method]).toBe("function");
    }
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
