import { CURRENT_SCHEMA_VERSION } from "../../../../src/runtime/state-schema-version.js";

const ARCHIVE_VERSION = 1;
const ARCHIVE_FILENAME = "checkpoint-v1.json";
const BACKUP_FILENAME = "checkpoint-backup-v1.json";
const MAX_SESSION_FILES = 100;
const MAX_SESSION_BYTES = 128 * 1_024 * 1_024;
const MAX_SESSION_ENTRY_BYTES = 32 * 1_024 * 1_024;
const MAX_STATE_BYTES = 32 * 1_024 * 1_024;
const MAX_ARCHIVE_BYTES = 256 * 1_024 * 1_024;
const SQLITE_SIGNATURE = "SQLite format 3\0";

export function createBrowserDataStore(options = {}) {
  return new BrowserDataStore(options);
}

class BrowserDataStore {
  constructor(options = {}) {
    this.getRoot = options.getRoot ?? getOpenCandleDirectory;
    this.now = options.now ?? (() => new Date().toISOString());
    this.validateStateDatabase = options.validateStateDatabase ?? validateStateDatabaseBytes;
    this.queue = Promise.resolve();
  }

  async readRuntimeSnapshot() {
    return this.enqueue(async () => {
      const archive = await this.readArchiveWithBackupRecovery();
      if (!archive) return { sessions: [], stateBytes: undefined, currentSessionId: "" };
      return decodeHostedArchive(archive);
    });
  }

  async readOfflineBootstrap() {
    return this.enqueue(async () => (await this.readArchiveWithBackupRecovery())?.bootstrap ?? null);
  }

  async persistCheckpoint(value) {
    return this.enqueue(async () => {
      const checkpoint = value?.checkpoint;
      if (!checkpoint || typeof checkpoint !== "object") return false;
      const sessions = Array.isArray(checkpoint.sessions) ? checkpoint.sessions : [];
      const state = checkpoint.state;
      const stateBytes =
        state?.format === "sqlite3" &&
        state?.filename === "current.sqlite3" &&
        typeof state.contentBase64 === "string"
          ? decodeBase64(state.contentBase64)
          : undefined;
      const previous = await this.readArchive();
      const archive = createHostedArchive({
        sessions,
        stateBytes,
        currentSessionId:
          typeof value.sessionId === "string" ? value.sessionId : previous?.currentSessionId,
        bootstrap: isBootstrapResponse(value) ? value : previous?.bootstrap,
        now: this.now(),
      });
      await this.writeArchive(archive);
      return true;
    });
  }

  async exportAll() {
    return this.enqueue(async () => {
      const existing = await this.readArchive();
      const archive = existing
        ? { ...existing, createdAt: this.now() }
        : createHostedArchive({ sessions: [], now: this.now() });
      validateHostedArchive(archive);
      return JSON.stringify(archive, null, 2);
    });
  }

  async importAll(serialized) {
    return this.enqueue(async () => {
      const archive = this.validateImport(serialized);
      if (archive.stateBase64) {
        await this.validateStateDatabase(decodeBase64(archive.stateBase64));
      }
      let current;
      try {
        current = await this.readArchive();
      } catch {
        // A validated import is also the recovery path for a corrupt current
        // checkpoint. Do not let unreadable local state block replacement.
        current = undefined;
      }
      if (current) {
        const root = await this.getRoot();
        await writeFile(root, BACKUP_FILENAME, JSON.stringify(current));
      }
      await this.writeArchive(archive);
      return decodeHostedArchive(archive);
    });
  }

  async validateImportForRestore(serialized) {
    const archive = this.validateImport(serialized);
    if (archive.stateBase64) {
      await this.validateStateDatabase(decodeBase64(archive.stateBase64));
    }
    return archive;
  }

  validateImport(serialized) {
    if (typeof serialized !== "string" || byteLength(serialized) > MAX_ARCHIVE_BYTES) {
      throw new Error("Hosted archive size is invalid");
    }
    let candidate;
    try {
      candidate = JSON.parse(serialized);
    } catch {
      throw new Error("Hosted archive is not valid JSON");
    }
    return validateHostedArchive(candidate);
  }

  async clearAll() {
    return this.enqueue(async () => {
      const root = await this.getRoot();
      for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true });
    });
  }

  async createBackup() {
    return this.enqueue(async () => {
      const archive = await this.readArchive();
      if (!archive) return false;
      const root = await this.getRoot();
      await writeFile(root, BACKUP_FILENAME, JSON.stringify(archive));
      return true;
    });
  }

  async restoreBackup() {
    return this.enqueue(() => this.restoreBackupFile());
  }

  enqueue(operation) {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async readArchive() {
    const root = await this.getRoot();
    try {
      const handle = await root.getFileHandle(ARCHIVE_FILENAME);
      const file = await handle.getFile();
      if (file.size > MAX_ARCHIVE_BYTES) throw new Error("Hosted archive is too large");
      return validateHostedArchive(JSON.parse(await file.text()));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async readArchiveWithBackupRecovery() {
    try {
      return await this.readArchive();
    } catch (error) {
      if (!(await this.restoreBackupFile())) throw error;
      return this.readArchive();
    }
  }

  async writeArchive(archive) {
    const validated = validateHostedArchive(archive);
    const serialized = JSON.stringify(validated);
    if (byteLength(serialized) > MAX_ARCHIVE_BYTES) throw new Error("Hosted archive is too large");
    const root = await this.getRoot();
    await writeFile(root, ARCHIVE_FILENAME, serialized);
  }

  async restoreBackupFile() {
    const root = await this.getRoot();
    try {
      const handle = await root.getFileHandle(BACKUP_FILENAME);
      const archive = validateHostedArchive(JSON.parse(await (await handle.getFile()).text()));
      await this.writeArchive(archive);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }
}

async function validateStateDatabaseBytes(bytes) {
  let database;
  try {
    const module = await import("sql.js");
    const SQL = await module.default({
      locateFile: (filename) => `/runtime/${filename}`,
    });
    database = new SQL.Database(bytes);
    const integrity = database.exec("PRAGMA integrity_check");
    if (integrity[0]?.values[0]?.[0] !== "ok") {
      throw new Error("State snapshot failed SQLite integrity check");
    }
    const versionResult = database.exec("SELECT version FROM schema_version LIMIT 1");
    const version = versionResult[0]?.values[0]?.[0];
    if (!Number.isInteger(version) || version < 1) {
      throw new Error("State snapshot schema version is invalid");
    }
    if (version > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `State snapshot uses newer schema version ${version}; this build supports version ${CURRENT_SCHEMA_VERSION}`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("State snapshot")) throw error;
    throw new Error("State snapshot is not a valid OpenCandle SQLite database");
  } finally {
    database?.close();
  }
}

export function createHostedArchive({
  sessions = [],
  stateBytes,
  currentSessionId = "",
  bootstrap,
  now = new Date().toISOString(),
}) {
  const archive = {
    version: ARCHIVE_VERSION,
    createdAt: now,
    sessions: sessions.map((session) => ({
      filename: session.filename,
      content: session.content,
    })),
    stateBase64: stateBytes ? encodeBase64(stateBytes) : "",
    currentSessionId: typeof currentSessionId === "string" ? currentSessionId : "",
    ...(bootstrap ? { bootstrap: sanitizeBootstrap(bootstrap) } : {}),
  };
  return validateHostedArchive(archive);
}

export function validateHostedArchive(value) {
  if (!isRecord(value) || value.version !== ARCHIVE_VERSION) {
    throw new Error("Unsupported hosted archive version");
  }
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error("Hosted archive timestamp is invalid");
  }
  if (!Array.isArray(value.sessions) || value.sessions.length > MAX_SESSION_FILES) {
    throw new Error("Hosted archive session count is invalid");
  }
  const sessionIds = new Set();
  const filenames = new Set();
  for (const session of value.sessions) {
    if (!isRecord(session)) throw new Error("Session snapshot is invalid");
    validateSessionFilename(session.filename);
    const sessionId = validateSessionContent(session.content);
    if (filenames.has(session.filename) || sessionIds.has(sessionId)) {
      throw new Error("Duplicate session identity in hosted archive");
    }
    filenames.add(session.filename);
    sessionIds.add(sessionId);
  }
  if (typeof value.stateBase64 !== "string") throw new Error("State snapshot is invalid");
  if (value.stateBase64) validateStateBytes(decodeBase64(value.stateBase64));
  if (typeof value.currentSessionId !== "string" || value.currentSessionId.length > 220) {
    throw new Error("Current session identity is invalid");
  }
  if (value.currentSessionId && !sessionIds.has(value.currentSessionId)) {
    throw new Error("Current session is absent from hosted archive");
  }
  if (value.bootstrap !== undefined) validateBootstrap(value.bootstrap);
  if (byteLength(JSON.stringify(value)) > MAX_ARCHIVE_BYTES) {
    throw new Error("Hosted archive is too large");
  }
  return value;
}

export function decodeHostedArchive(value) {
  const archive = validateHostedArchive(value);
  return {
    sessions: archive.sessions.map((session) => ({ ...session })),
    stateBytes: archive.stateBase64 ? decodeBase64(archive.stateBase64) : undefined,
    currentSessionId: archive.currentSessionId,
    bootstrap: archive.bootstrap ? structuredClone(archive.bootstrap) : null,
  };
}

function validateSessionFilename(filename) {
  if (typeof filename !== "string" || !/^[A-Za-z0-9_.-]{1,220}\.jsonl$/.test(filename)) {
    throw new Error("Session filename is invalid");
  }
  return filename;
}

function validateSessionContent(content) {
  if (typeof content !== "string") throw new Error("Session snapshot is invalid");
  const bytes = byteLength(content);
  if (bytes === 0 || bytes > MAX_SESSION_BYTES) throw new Error("Session snapshot size is invalid");
  const lines = content.split("\n").filter(Boolean);
  if (lines.length === 0 || lines.length > 20_000) throw new Error("Session snapshot is invalid");
  const parsed = lines.map((line) => {
    if (byteLength(line) > MAX_SESSION_ENTRY_BYTES) throw new Error("Session entry is too large");
    try {
      return JSON.parse(line);
    } catch {
      throw new Error("Session entry is not valid JSON");
    }
  });
  const header = parsed[0];
  if (
    !isRecord(header) ||
    header.type !== "session" ||
    typeof header.id !== "string" ||
    !header.id ||
    header.id.length > 220 ||
    !Number.isInteger(header.version) ||
    header.version < 1 ||
    header.version > 3
  ) {
    throw new Error("Session snapshot header is invalid");
  }
  const entries = new Set();
  for (const entry of parsed.slice(1)) {
    if (
      !isRecord(entry) ||
      typeof entry.type !== "string" ||
      typeof entry.id !== "string" ||
      !entry.id ||
      !(entry.parentId === null || typeof entry.parentId === "string")
    ) {
      throw new Error("Session entry shape is invalid");
    }
    if (entries.has(entry.id)) throw new Error("Duplicate session entry identity");
    if (entry.parentId !== null && !entries.has(entry.parentId)) {
      throw new Error("Session entry parentId does not reference an earlier entry");
    }
    entries.add(entry.id);
  }
  return header.id;
}

function validateStateBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 100 || bytes.byteLength > MAX_STATE_BYTES) {
    throw new Error("State snapshot size is invalid");
  }
  if (new TextDecoder().decode(bytes.slice(0, 16)) !== SQLITE_SIGNATURE) {
    throw new Error("State snapshot is not SQLite");
  }
}

function sanitizeBootstrap(value) {
  if (!isRecord(value)) return undefined;
  const modelSetup = isRecord(value.modelSetup)
    ? {
        requirement: stringOrEmpty(value.modelSetup.requirement),
        providers: safeArray(value.modelSetup.providers),
        availableModels: safeArray(value.modelSetup.availableModels),
        currentModel: stringOrEmpty(value.modelSetup.currentModel),
        storageMode: stringOrEmpty(value.modelSetup.storageMode),
        hosted: true,
      }
    : undefined;
  return stripUndefined({
    role: stringOrEmpty(value.role) || "writer",
    sessionId: stringOrEmpty(value.sessionId),
    sessions: safeArray(value.sessions),
    snapshot: isRecord(value.snapshot) ? value.snapshot : {},
    coordination: isRecord(value.coordination) ? value.coordination : {},
    catalog: isRecord(value.catalog) ? value.catalog : {},
    modelSetup,
    supportsSessionActions: value.supportsSessionActions !== false,
  });
}

function validateBootstrap(value) {
  if (!isRecord(value) || typeof value.sessionId !== "string" || !Array.isArray(value.sessions)) {
    throw new Error("Offline bootstrap snapshot is invalid");
  }
  const serialized = JSON.stringify(value);
  if (byteLength(serialized) > MAX_SESSION_BYTES) {
    throw new Error("Offline bootstrap snapshot is too large");
  }
  if (containsCredentialField(value)) {
    throw new Error("Offline bootstrap snapshot contains credential-bearing data");
  }
}

function containsCredentialField(value) {
  if (Array.isArray(value)) return value.some(containsCredentialField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, child]) =>
      /^(?:api[_-]?key|authorization|credentials?|secret|access[_-]?token|refresh[_-]?token)$/i.test(
        key,
      ) || containsCredentialField(child),
  );
}

function isBootstrapResponse(value) {
  return isRecord(value) && Array.isArray(value.sessions) && isRecord(value.snapshot);
}

function safeArray(value) {
  return Array.isArray(value) ? structuredClone(value) : [];
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function encodeBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error("State snapshot is not valid base64");
  }
}

function isNotFound(error) {
  return error instanceof DOMException && error.name === "NotFoundError";
}

async function getOpenCandleDirectory() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("opencandle-hosted-v1", { create: true });
}

async function writeFile(directory, filename, content) {
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(content);
    await writable.close();
  } catch (error) {
    await writable.abort();
    throw error;
  }
}
