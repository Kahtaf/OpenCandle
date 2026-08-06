import { describe, expect, it, vi } from "vitest";
import {
  createBrowserDataStore,
  createHostedArchive,
  decodeHostedArchive,
  decodeStateBase64,
  validateHostedArchive,
} from "../../../gui/hosted/src/runtime/browser-data-store.js";
import { createSqlJsStateDatabase } from "../../../src/runtime/sqljs-state-database-node.js";

const session = {
  filename: "2026-07-31_session-1.jsonl",
  content: `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "session-1",
      timestamp: "2026-07-31T12:00:00.000Z",
      cwd: "/workspace",
    }),
    JSON.stringify({
      type: "message",
      id: "entry-1",
      parentId: null,
      timestamp: "2026-07-31T12:00:01.000Z",
      message: { role: "user", content: [{ type: "text", text: "Hello" }], timestamp: 1 },
    }),
  ].join("\n")}\n`,
};

const sqlite = Uint8Array.from([
  ...new TextEncoder().encode("SQLite format 3\0"),
  ...new Uint8Array(100),
]);

describe("hosted browser archive", () => {
  it("keeps canonical session action sidecars with their Pi session", () => {
    const actionStore = JSON.stringify({
      acceptedActionIds: ["run-1"],
      pendingActionIds: [],
      actionFingerprints: { "run-1": "fingerprint" },
    });
    const archive = createHostedArchive({ sessions: [{ ...session, actionStore }] });

    expect(decodeHostedArchive(archive).sessions).toEqual([{ ...session, actionStore }]);
    expect(() =>
      validateHostedArchive({
        ...archive,
        sessions: [{ ...session, actionStore: "not json" }],
      }),
    ).toThrow("action snapshot");
  });

  it.each([-1, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid pending action timestamps: %s",
    (pendingAtMs) => {
      expect(() =>
        createHostedArchive({
          sessions: [
            {
              ...session,
              actionStore: JSON.stringify({
                acceptedActionIds: [],
                pendingActionIds: [{ id: "action-1", pendingAtMs }],
                actionFingerprints: {},
              }),
            },
          ],
        }),
      ).toThrow("action snapshot");
    },
  );

  it("preserves SQLite when a session-only checkpoint omits unchanged state", async () => {
    const files = new Map<string, string>();
    const store = createBrowserDataStore({
      getRoot: async () => createMemoryDirectory(files),
      validateStateDatabase: async () => {},
    });
    await store.persistCheckpoint({
      sessionId: "session-1",
      checkpoint: {
        sessions: [session],
        state: {
          format: "sqlite3",
          filename: "current.sqlite3",
          contentBase64: btoa(String.fromCharCode(...sqlite)),
        },
      },
    });

    await store.persistCheckpoint({
      sessionId: "session-1",
      checkpoint: { sessions: [session] },
    });

    await expect(store.readRuntimeSnapshot()).resolves.toMatchObject({ stateBytes: sqlite });
  });

  it("refreshes the offline market snapshot on checkpoint-only writes", async () => {
    const files = new Map<string, string>();
    const store = createBrowserDataStore({
      getRoot: async () => createMemoryDirectory(files),
      validateStateDatabase: async () => {},
    });
    const checkpoint = {
      sessions: [session],
      state: {
        format: "sqlite3",
        filename: "current.sqlite3",
        contentBase64: btoa(String.fromCharCode(...sqlite)),
      },
    };
    await store.persistCheckpoint({
      role: "writer",
      sessionId: "session-1",
      sessions: [{ id: "session-1" }],
      snapshot: { sessionId: "session-1", entries: [], events: [], state: {} },
      marketState: { watchlist: [{ symbol: "AAPL" }] },
      checkpoint,
    });

    await store.persistCheckpoint({
      sessionId: "session-1",
      marketState: { watchlist: [{ symbol: "MSFT" }] },
      checkpoint: { sessions: [session] },
    });

    await expect(store.readOfflineBootstrap()).resolves.toMatchObject({
      marketState: { watchlist: [{ symbol: "MSFT" }] },
    });
  });

  it("rejects malformed explicit state instead of acknowledging the previous SQLite snapshot", async () => {
    const files = new Map<string, string>();
    const store = createBrowserDataStore({
      getRoot: async () => createMemoryDirectory(files),
      validateStateDatabase: async () => {},
    });
    await store.persistCheckpoint({
      sessionId: "session-1",
      checkpoint: {
        sessions: [session],
        state: {
          format: "sqlite3",
          filename: "current.sqlite3",
          contentBase64: btoa(String.fromCharCode(...sqlite)),
        },
      },
    });

    await expect(
      store.persistCheckpoint({
        sessionId: "session-1",
        checkpoint: { sessions: [session], state: { filename: "typo.sqlite3" } },
      }),
    ).rejects.toThrow("State checkpoint is invalid");
    await expect(store.readRuntimeSnapshot()).resolves.toMatchObject({ stateBytes: sqlite });
  });
  it("accepts attachment-sized Pi session entries above the old 1 MiB ceiling", () => {
    const largeSession = {
      ...session,
      content: `${session.content}${JSON.stringify({
        type: "message",
        id: "entry-large",
        parentId: "entry-1",
        timestamp: "2026-07-31T12:00:02.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "x".repeat(2 * 1_024 * 1_024) }],
          timestamp: 2,
        },
      })}\n`,
    };

    expect(
      validateHostedArchive(createHostedArchive({ sessions: [largeSession], stateBytes: sqlite })),
    ).toBeTruthy();
  });

  it("allows a valid import to replace a corrupt current checkpoint", async () => {
    const replacement = createHostedArchive({
      sessions: [session],
      stateBytes: sqlite,
      currentSessionId: "session-1",
    });
    const files = new Map([["checkpoint-v1.json", "not json"]]);
    const store = createBrowserDataStore({
      getRoot: async () => createMemoryDirectory(files),
      validateStateDatabase: async () => {},
    });

    await expect(store.importAll(JSON.stringify(replacement))).resolves.toMatchObject({
      currentSessionId: "session-1",
    });
    expect(JSON.parse(files.get("checkpoint-v1.json"))).toMatchObject({
      currentSessionId: "session-1",
    });
  });

  it("rejects a current-version SQLite import with an incompatible OpenCandle schema", async () => {
    const database = await createSqlJsStateDatabase();
    database.exec(
      "DROP TABLE portfolio_lots; CREATE TABLE portfolio_lots (id INTEGER PRIMARY KEY)",
    );
    const malformed = database.exportBytes();
    database.close();
    const archive = createHostedArchive({
      sessions: [session],
      stateBytes: malformed,
      currentSessionId: "session-1",
    });
    const store = createBrowserDataStore({
      getRoot: async () => createMemoryDirectory(new Map()),
    });

    await expect(store.importAll(JSON.stringify(archive))).rejects.toThrow(
      "missing required portfolio_lots columns",
    );
  });

  it("accepts a supported v6 SQLite import before the v7 alert migration", async () => {
    const database = await createSqlJsStateDatabase();
    database.exec(
      "UPDATE schema_version SET version = 6; ALTER TABLE alert_rules DROP COLUMN status",
    );
    const legacy = database.exportBytes();
    database.close();
    const archive = createHostedArchive({
      sessions: [session],
      stateBytes: legacy,
      currentSessionId: "session-1",
    });
    const store = createBrowserDataStore({
      getRoot: async () => createMemoryDirectory(new Map()),
    });

    await expect(store.validateImportForRestore(JSON.stringify(archive))).resolves.toBeTruthy();
  });

  it("restores the pre-update backup when the current checkpoint is corrupt", async () => {
    const archive = createHostedArchive({
      sessions: [session],
      stateBytes: sqlite,
      currentSessionId: "session-1",
    });
    const files = new Map([["checkpoint-v1.json", JSON.stringify(archive)]]);
    const directory = createMemoryDirectory(files);
    const store = createBrowserDataStore({ getRoot: async () => directory });

    await expect(store.createBackup()).resolves.toBe(true);
    files.set("checkpoint-v1.json", "not json");

    await expect(store.readRuntimeSnapshot()).resolves.toMatchObject({
      currentSessionId: "session-1",
      sessions: [session],
      stateBytes: sqlite,
    });
    expect(files.get("checkpoint-v1.json")).toBe(JSON.stringify(archive));
  });

  it("restores offline bootstrap from backup when the current checkpoint is corrupt", async () => {
    const bootstrap = {
      role: "writer",
      sessionId: "session-1",
      sessions: [{ id: "session-1", name: "Recovered research" }],
      snapshot: { entries: [], events: [], state: {} },
      marketState: {
        watchlists: [{ id: 1, name: "Watchlist" }],
        watchlist: [{ id: 2, symbol: "AAPL" }],
      },
    };
    const archive = createHostedArchive({
      sessions: [session],
      currentSessionId: "session-1",
      bootstrap,
    });
    const files = new Map([
      ["checkpoint-v1.json", "not json"],
      ["checkpoint-backup-v1.json", JSON.stringify(archive)],
    ]);
    const store = createBrowserDataStore({
      getRoot: async () => createMemoryDirectory(files),
    });

    await expect(store.readOfflineBootstrap()).resolves.toMatchObject(bootstrap);
    expect(files.get("checkpoint-v1.json")).toBe(JSON.stringify(archive));
  });

  it("repairs stale local bootstrap session references left by older builds", async () => {
    const archive = createHostedArchive({
      sessions: [session],
      currentSessionId: "session-1",
      bootstrap: {
        role: "writer",
        sessionId: "session-1",
        sessions: [{ id: "session-1" }],
        snapshot: { sessionId: "session-1", entries: [], events: [], state: {} },
        coordination: { writable: true },
        catalog: { tools: [], workflows: [], providers: [] },
      },
    });
    archive.bootstrap.sessions.push({ id: "deleted-session", name: "Deleted" });
    const files = new Map([["checkpoint-v1.json", JSON.stringify(archive)]]);
    const store = createBrowserDataStore({
      getRoot: async () => createMemoryDirectory(files),
    });

    await expect(store.readOfflineBootstrap()).resolves.toMatchObject({
      sessions: [{ id: "session-1" }],
    });
    expect(JSON.parse(files.get("checkpoint-v1.json") || "null").bootstrap.sessions).toEqual([
      { id: "session-1" },
    ]);
    expect(() => validateHostedArchive(archive)).toThrow("saved session list disagrees");
  });

  it("discards an offline projection whose current session was removed", async () => {
    const archive = createHostedArchive({
      sessions: [session],
      currentSessionId: "session-1",
      bootstrap: {
        role: "writer",
        sessionId: "session-1",
        sessions: [{ id: "session-1" }],
        snapshot: { sessionId: "session-1", entries: [], events: [], state: {} },
        coordination: { writable: true },
        catalog: { tools: [], workflows: [], providers: [] },
      },
    });
    archive.bootstrap.sessionId = "deleted-session";
    archive.bootstrap.snapshot.sessionId = "deleted-session";
    const files = new Map([["checkpoint-v1.json", JSON.stringify(archive)]]);
    const store = createBrowserDataStore({
      getRoot: async () => createMemoryDirectory(files),
    });

    await expect(store.readRuntimeSnapshot()).resolves.toMatchObject({
      currentSessionId: "session-1",
      sessions: [session],
    });
    await expect(store.readOfflineBootstrap()).resolves.toBeNull();
    expect(JSON.parse(files.get("checkpoint-v1.json") || "null").bootstrap).toBeUndefined();
  });

  it("self-heals a malformed offline projection while preserving durable state", async () => {
    const archive = createHostedArchive({
      sessions: [session],
      stateBytes: sqlite,
      currentSessionId: "session-1",
      bootstrap: {
        role: "writer",
        sessionId: "session-1",
        sessions: [{ id: "session-1" }],
        snapshot: { sessionId: "session-1", entries: [], events: [], state: {} },
        coordination: { writable: true },
        catalog: { tools: [], workflows: [], providers: [] },
      },
    });
    archive.bootstrap.snapshot.entries = {};
    const files = new Map([["checkpoint-v1.json", JSON.stringify(archive)]]);
    const store = createBrowserDataStore({
      getRoot: async () => createMemoryDirectory(files),
    });

    await expect(store.readRuntimeSnapshot()).resolves.toMatchObject({
      currentSessionId: "session-1",
      sessions: [session],
      stateBytes: sqlite,
    });
    await expect(store.readOfflineBootstrap()).resolves.toBeNull();
    expect(JSON.parse(files.get("checkpoint-v1.json") || "null").bootstrap).toBeUndefined();
  });

  it("serializes archive reads and writes across concurrent GUI checkpoints", async () => {
    let content = JSON.stringify(
      createHostedArchive({
        sessions: [session],
        stateBytes: sqlite,
        currentSessionId: "session-1",
      }),
    );
    let acquired = false;
    const directory = {
      async getFileHandle() {
        return {
          async getFile() {
            if (acquired) throw new DOMException("concurrent file access", "NotReadableError");
            acquired = true;
            await new Promise((resolve) => setTimeout(resolve, 5));
            const snapshot = content;
            acquired = false;
            return { size: snapshot.length, text: async () => snapshot };
          },
          async createWritable() {
            if (acquired) throw new DOMException("concurrent file access", "NotReadableError");
            acquired = true;
            let pending = content;
            return {
              async write(value: string) {
                pending = value;
                await new Promise((resolve) => setTimeout(resolve, 5));
              },
              async close() {
                content = pending;
                acquired = false;
              },
              async abort() {
                acquired = false;
              },
            };
          },
        };
      },
    };
    const store = createBrowserDataStore({ getRoot: async () => directory });
    const checkpoint = {
      sessionId: "session-1",
      sessions: [{ id: "session-1" }],
      snapshot: { sessionId: "session-1", entries: [], events: [], state: {} },
      checkpoint: {
        sessions: [session],
        state: {
          format: "sqlite3",
          filename: "current.sqlite3",
          contentBase64: btoa(String.fromCharCode(...sqlite)),
        },
      },
    };

    const [persisted, exported] = await Promise.all([
      store.persistCheckpoint(checkpoint),
      store.exportAll(),
    ]);

    expect(persisted).toBe(true);
    expect(validateHostedArchive(JSON.parse(exported))).toBeTruthy();
  });

  it("round-trips canonical Pi sessions and SQLite without credentials", () => {
    const archive = createHostedArchive({
      sessions: [session],
      stateBytes: sqlite,
      currentSessionId: "session-1",
      bootstrap: {
        role: "writer",
        sessionId: "session-1",
        sessions: [{ id: "session-1", name: "Research" }],
        modelSetup: { requirement: "ready", apiKey: "must-not-export" },
        snapshot: { events: [{ type: "message.created", id: "entry-1" }] },
      },
      now: "2026-07-31T12:00:02.000Z",
    });

    expect(JSON.stringify(archive)).not.toContain("must-not-export");
    expect(validateHostedArchive(archive)).toEqual(archive);
    expect(decodeHostedArchive(archive)).toMatchObject({
      sessions: [session],
      currentSessionId: "session-1",
      stateBytes: sqlite,
      bootstrap: {
        role: "writer",
        sessionId: "session-1",
        modelSetup: { requirement: "ready" },
      },
    });
  });

  it("does not confuse ordinary research language with stored credentials", () => {
    const archive = createHostedArchive({
      sessions: [session],
      stateBytes: sqlite,
      currentSessionId: "session-1",
      bootstrap: {
        role: "writer",
        sessionId: "session-1",
        sessions: [{ id: "session-1", name: "FDA authorization research" }],
        snapshot: {
          entries: [
            {
              type: "message",
              message: {
                role: "user",
                content: [{ type: "text", text: "Compare bearer bonds and Victoria's Secret." }],
              },
            },
          ],
          events: [],
          state: {},
        },
      },
    });

    expect(validateHostedArchive(archive)).toEqual(archive);
  });

  it("rejects credential-bearing fields in an offline bootstrap", () => {
    const archive = createHostedArchive({
      sessions: [session],
      stateBytes: sqlite,
      currentSessionId: "session-1",
      bootstrap: {
        role: "writer",
        sessionId: "session-1",
        sessions: [{ id: "session-1" }],
        snapshot: { entries: [], events: [], state: {} },
      },
    });
    archive.bootstrap.snapshot.apiKey = "must-not-persist";

    expect(() => validateHostedArchive(archive)).toThrow("credential-bearing data");
  });

  it("rejects malformed or mismatched offline bootstrap session state", () => {
    const archive = createHostedArchive({
      sessions: [session],
      currentSessionId: "session-1",
      bootstrap: {
        role: "writer",
        sessionId: "session-1",
        sessions: [{ id: "session-1", name: "Research" }],
        snapshot: { sessionId: "session-1", entries: [], events: [], state: {} },
        coordination: { writable: true },
        catalog: { tools: [], workflows: [], providers: [] },
      },
    });

    const malformedSession = structuredClone(archive);
    malformedSession.bootstrap.sessions = [null];
    expect(() => validateHostedArchive(malformedSession)).toThrow("Offline bootstrap");

    const mismatchedSession = structuredClone(archive);
    mismatchedSession.bootstrap.sessionId = "session-other";
    expect(() => validateHostedArchive(mismatchedSession)).toThrow("Offline bootstrap");

    const malformedSnapshot = structuredClone(archive);
    malformedSnapshot.bootstrap.snapshot.entries = {};
    expect(() => validateHostedArchive(malformedSnapshot)).toThrow("Offline bootstrap");
  });

  it("allows the durable current session to be hidden from the empty-session display list", () => {
    const archive = createHostedArchive({
      sessions: [session],
      currentSessionId: "session-1",
      bootstrap: {
        role: "writer",
        sessionId: "session-1",
        sessions: [],
        snapshot: { sessionId: "session-1", entries: [], events: [], state: {} },
        coordination: { writable: true },
        catalog: { tools: [], workflows: [], providers: [] },
      },
    });

    expect(validateHostedArchive(archive)).toEqual(archive);
  });

  it("rejects corrupt session trees, state, paths, and archive versions", () => {
    const archive = createHostedArchive({ sessions: [session], stateBytes: sqlite });
    const parsed = JSON.parse(JSON.stringify(archive));
    parsed.sessions[0].content += `${JSON.stringify({
      type: "message",
      id: "entry-2",
      parentId: "missing",
      timestamp: "2026-07-31T12:00:03.000Z",
      message: { role: "assistant", content: [] },
    })}\n`;
    expect(() => validateHostedArchive(parsed)).toThrow("parentId");
    expect(() => validateHostedArchive({ ...archive, version: 2 })).toThrow("version");
    expect(() =>
      validateHostedArchive({
        ...archive,
        sessions: [{ ...session, filename: "../escape.jsonl" }],
      }),
    ).toThrow("filename");
    expect(() => validateHostedArchive({ ...archive, stateBase64: "bm90LXNxbGl0ZQ==" })).toThrow(
      "State snapshot",
    );
  });

  it("rejects oversized encoded state before calling atob", () => {
    const originalAtob = globalThis.atob;
    const atob = vi.fn(originalAtob);
    globalThis.atob = atob;
    try {
      expect(() => decodeStateBase64("A".repeat(140), 32)).toThrow("size");
      expect(atob).not.toHaveBeenCalled();
    } finally {
      globalThis.atob = originalAtob;
    }
  });

  it("validates an import before touching browser-owned files", () => {
    const getRoot = vi.fn();
    const store = createBrowserDataStore({ getRoot });

    expect(() => store.validateImport('{"version":999}')).toThrow(
      "Unsupported hosted archive version",
    );
    expect(getRoot).not.toHaveBeenCalled();
  });

  it("backs up the current archive before replacing it during import", async () => {
    const current = createHostedArchive({
      sessions: [session],
      stateBytes: sqlite,
      currentSessionId: "session-1",
      now: "2026-07-31T12:00:00.000Z",
    });
    const replacement = createHostedArchive({ now: "2026-07-31T12:05:00.000Z" });
    const files = new Map([["checkpoint-v1.json", JSON.stringify(current)]]);
    const store = createBrowserDataStore({ getRoot: async () => createMemoryDirectory(files) });

    await store.importAll(JSON.stringify(replacement));

    expect(JSON.parse(files.get("checkpoint-backup-v1.json") || "null")).toEqual(current);
    expect(JSON.parse(files.get("checkpoint-v1.json") || "null")).toEqual(replacement);
  });

  it("fully validates SQLite state before replacing the current archive", async () => {
    const current = createHostedArchive({ sessions: [session], currentSessionId: "session-1" });
    const replacement = createHostedArchive({ stateBytes: sqlite });
    const files = new Map([["checkpoint-v1.json", JSON.stringify(current)]]);
    const validateStateDatabase = vi.fn(async () => {
      throw new Error("State snapshot failed SQLite integrity check");
    });
    const store = createBrowserDataStore({
      getRoot: async () => createMemoryDirectory(files),
      validateStateDatabase,
    });

    await expect(store.importAll(JSON.stringify(replacement))).rejects.toThrow("integrity check");

    expect(validateStateDatabase).toHaveBeenCalledOnce();
    expect(JSON.parse(files.get("checkpoint-v1.json") || "null")).toEqual(current);
    expect(files.has("checkpoint-backup-v1.json")).toBe(false);
  });

  it("rejects duplicate session and entry identities", () => {
    const archive = createHostedArchive({ sessions: [session], stateBytes: sqlite });
    expect(() =>
      validateHostedArchive({ ...archive, sessions: [session, { ...session }] }),
    ).toThrow("Duplicate session");

    const duplicateEntry = {
      ...session,
      content: `${session.content}${session.content.split("\n")[1]}\n`,
    };
    expect(() => validateHostedArchive({ ...archive, sessions: [duplicateEntry] })).toThrow(
      "Duplicate session entry",
    );
  });
});

function createMemoryDirectory(files: Map<string, string>) {
  return {
    async getFileHandle(name: string, options: { create?: boolean } = {}) {
      if (!files.has(name) && !options.create) throw new DOMException("missing", "NotFoundError");
      if (!files.has(name)) files.set(name, "");
      return {
        async getFile() {
          const content = files.get(name) ?? "";
          return { size: content.length, text: async () => content };
        },
        async createWritable() {
          let pending = files.get(name) ?? "";
          return {
            async write(value: string) {
              pending = value;
            },
            async close() {
              files.set(name, pending);
            },
            async abort() {},
          };
        },
      };
    },
  };
}
