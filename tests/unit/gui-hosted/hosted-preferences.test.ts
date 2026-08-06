import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BrowserHostedGuiRuntime } from "../../../gui/hosted/runtime/browser-hosted-gui-runtime.js";
import { parseGuiRequest } from "../../../gui/hosted/runtime/request-contract.js";
import { createBrowserRuntimeHost } from "../../../gui/hosted/src/runtime/browser-runtime-host.js";
import { HOSTED_GUI_READ_ACTIONS } from "../../../gui/shared/hosted-gui-protocol.js";
import { buildPreferencesSnapshot } from "../../../src/memory/preferences-view.js";
import { buildMemoryContext } from "../../../src/memory/retrieval.js";
import { initializeStateDatabase } from "../../../src/memory/sqlite.js";
import { MemoryStorage } from "../../../src/memory/storage.js";
import { setDefault } from "../../../src/memory/tool-defaults.js";
import { createSqlJsStateDatabase } from "../../../src/runtime/sqljs-state-database-node.js";

describe("hosted preferences request contract", () => {
  it("accepts the three preference actions", () => {
    expect(parseGuiRequest({ action: "preferences_list" })).toEqual({
      action: "preferences_list",
    });
    expect(
      parseGuiRequest({ action: "preferences_delete", namespace: " global ", key: "risk_profile" }),
    ).toEqual({ action: "preferences_delete", namespace: "global", key: "risk_profile" });
    expect(
      parseGuiRequest({
        action: "tool_defaults_delete",
        toolName: "get_stock_history",
        paramPath: "range",
      }),
    ).toEqual({
      action: "tool_defaults_delete",
      toolName: "get_stock_history",
      paramPath: "range",
    });
  });

  it("rejects unusable identifiers", () => {
    expect(() =>
      parseGuiRequest({ action: "preferences_delete", namespace: "", key: "k" }),
    ).toThrow(/namespace/i);
    expect(() =>
      parseGuiRequest({ action: "preferences_delete", namespace: "global", key: "" }),
    ).toThrow(/key/i);
    expect(() =>
      parseGuiRequest({ action: "preferences_delete", namespace: "global", key: "x".repeat(400) }),
    ).toThrow(/key/i);
    expect(() =>
      parseGuiRequest({ action: "tool_defaults_delete", toolName: "Bad Tool", paramPath: "range" }),
    ).toThrow(/tool/i);
    expect(() =>
      parseGuiRequest({
        action: "tool_defaults_delete",
        toolName: "get_stock_history",
        paramPath: "",
      }),
    ).toThrow(/parameter/i);
  });

  it("treats listing as a read and deleting as a mutation", () => {
    expect(HOSTED_GUI_READ_ACTIONS).toContain("preferences_list");
    expect(HOSTED_GUI_READ_ACTIONS).not.toContain("preferences_delete");
    expect(HOSTED_GUI_READ_ACTIONS).not.toContain("tool_defaults_delete");
  });
});

describe("hosted preferences runtime", () => {
  it("lists both stores from the browser SQLite state", async () => {
    const { runtime } = await createRuntime();

    expect(runtime.listPreferences()).toEqual({
      preferences: [
        {
          namespace: "global",
          key: "risk_profile",
          value: "balanced",
          source: "explicit",
          confidence: "high",
          updatedAt: expect.any(String),
        },
      ],
      toolDefaults: [
        {
          toolName: "get_stock_history",
          paramPath: "range",
          value: "6mo",
          setAt: expect.any(String),
        },
      ],
    });
  });

  it("deletes a preference and carries the deletion into the checkpoint", async () => {
    const { runtime } = await createRuntime();

    const result = await runtime.deletePreference("global", "risk_profile");

    expect(result.preferences.preferences).toEqual([]);
    expect(result.preferences.toolDefaults).toHaveLength(1);
    await withCheckpointedDatabase(result, (restored) => {
      expect(buildPreferencesSnapshot(restored)).toMatchObject({
        preferences: [],
        toolDefaults: [{ paramPath: "range" }],
      });
      // The reader that feeds agent prompt context no longer sees it either.
      expect(buildMemoryContext(new MemoryStorage(restored))).not.toContain("risk_profile");
    });
  });

  it("deletes a tool default and carries the deletion into the checkpoint", async () => {
    const { runtime } = await createRuntime();

    const result = await runtime.deleteToolDefault("get_stock_history", "range");

    expect(result.preferences.toolDefaults).toEqual([]);
    await withCheckpointedDatabase(result, (restored) => {
      expect(buildPreferencesSnapshot(restored)).toMatchObject({
        preferences: [{ key: "risk_profile" }],
        toolDefaults: [],
      });
    });
  });
});

describe("hosted preferences commands", () => {
  it("routes each command to its runtime action and returns the list payload", async () => {
    const snapshot = { preferences: [], toolDefaults: [] };
    const host = createBrowserRuntimeHost({
      storage: memoryStorage(),
      sessionStorage: memoryStorage(),
    });
    const request = vi.fn(async (_operation: string, payload: Record<string, unknown>) =>
      payload.action === "preferences_list" ? snapshot : { preferences: snapshot },
    );
    Object.assign(host, { request });

    await expect(host.handleCommand({ type: "preferences.list" })).resolves.toEqual(snapshot);
    expect(request).toHaveBeenLastCalledWith("gui", { action: "preferences_list" });

    await expect(
      host.handleCommand({ type: "preferences.delete", namespace: "global", key: "risk_profile" }),
    ).resolves.toEqual(snapshot);
    expect(request).toHaveBeenLastCalledWith("gui", {
      action: "preferences_delete",
      namespace: "global",
      key: "risk_profile",
    });

    await expect(
      host.handleCommand({
        type: "tool_defaults.delete",
        toolName: "get_stock_history",
        paramPath: "range",
      }),
    ).resolves.toEqual(snapshot);
    expect(request).toHaveBeenLastCalledWith("gui", {
      action: "tool_defaults_delete",
      toolName: "get_stock_history",
      paramPath: "range",
    });
  });
});

async function createRuntime() {
  const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-hosted-preferences-"));
  const database = await createSqlJsStateDatabase();
  initializeStateDatabase(database);
  new MemoryStorage(database).upsertPreference({
    namespace: "global",
    key: "risk_profile",
    valueJson: JSON.stringify("balanced"),
    confidence: "high",
    source: "explicit",
  });
  setDefault("get_stock_history", "range", "6mo", database);

  const runtime = new (
    BrowserHostedGuiRuntime as never as new (
      options: Record<string, unknown>,
      database: unknown,
    ) => BrowserHostedGuiRuntime & Record<string, unknown>
  )(
    {
      cwd: "/workspace",
      sessionDir,
      stateFile: join(sessionDir, "current.sqlite3"),
    },
    database,
  );
  // The checkpoint is real; only the surrounding transcript payload is stubbed,
  // so a delete still has to reach the exported SQLite bytes.
  runtime.buildBootstrap = vi.fn(async () => ({
    sessionId: "session-1",
    checkpoint: (runtime as unknown as { checkpoint: () => unknown }).checkpoint(),
    marketState: {},
  }));
  runtime.resolveCurrentManager = vi.fn(async () => ({ getSessionId: () => "session-1" }));
  return { runtime, database };
}

/** Reopens the SQLite bytes the checkpoint carried, the way a reload would. */
async function withCheckpointedDatabase(
  result: { checkpoint?: { state?: { contentBase64?: string } } },
  assert: (restored: Awaited<ReturnType<typeof createSqlJsStateDatabase>>) => void,
) {
  const contentBase64 = result.checkpoint?.state?.contentBase64 ?? "";
  const restored = await createSqlJsStateDatabase(Buffer.from(contentBase64, "base64"));
  try {
    assert(restored);
  } finally {
    restored.close();
  }
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, String(value)),
    removeItem: (key: string) => void values.delete(key),
  };
}
