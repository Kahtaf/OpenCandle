import { CURRENT_SCHEMA_VERSION } from "../../../../src/runtime/state-schema-version.js";

const ARCHIVE_VERSION = 1;
const ARCHIVE_FILENAME = "checkpoint-v1.json";
const BACKUP_FILENAME = "checkpoint-backup-v1.json";
const MAX_SESSION_FILES = 100;
const MAX_SESSION_BYTES = 128 * 1_024 * 1_024;
const MAX_SESSION_ENTRY_BYTES = 32 * 1_024 * 1_024;
const MAX_ACTION_STORE_BYTES = 1_024 * 1_024;
const MAX_STATE_BYTES = 32 * 1_024 * 1_024;
const MAX_ARCHIVE_BYTES = 256 * 1_024 * 1_024;
const MAX_ACTION_TIMESTAMP_SKEW_MS = 5 * 60 * 1_000;
const SQLITE_SIGNATURE = "SQLite format 3\0";
const REQUIRED_STATE_COLUMNS = {
  instruments: ["id", "symbol", "asset_type", "provider", "created_at", "updated_at"],
  watchlists: ["id", "name", "is_default", "created_at", "updated_at"],
  watchlist_items: ["id", "watchlist_id", "instrument_id", "created_at", "updated_at"],
  portfolios: ["id", "name", "base_currency", "is_default", "created_at", "updated_at"],
  portfolio_lots: [
    "id",
    "portfolio_id",
    "instrument_id",
    "quantity",
    "avg_cost",
    "currency",
    "created_at",
    "updated_at",
  ],
  alert_rules: ["id", "condition_type", "condition_json", "enabled"],
  report_templates: ["id", "name", "report_type", "config_json", "enabled"],
};
const VERSIONED_STATE_COLUMNS = [
  { since: 7, table: "alert_rules", columns: ["status"] },
];

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
      const previous = await this.readArchive();
      const state = checkpoint.state;
      let stateBytes;
      if (state === undefined) {
        stateBytes = previous?.stateBase64
          ? decodeStateBase64(previous.stateBase64)
          : undefined;
      } else if (
        state?.format === "sqlite3" &&
        state?.filename === "current.sqlite3" &&
        typeof state.contentBase64 === "string"
      ) {
        stateBytes = decodeBase64(state.contentBase64);
      } else {
        throw new Error("State checkpoint is invalid");
      }
      const archive = createHostedArchive({
        sessions,
        stateBytes,
        currentSessionId:
          typeof value.sessionId === "string" ? value.sessionId : previous?.currentSessionId,
        bootstrap: isBootstrapResponse(value)
          ? value
          : mergeCheckpointMarketState(previous?.bootstrap, value.marketState),
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
      const localArchive = reconcileLocalBootstrapSessions(JSON.parse(await file.text()));
      const repairedArchive = discardInvalidBootstrapProjection(localArchive.value);
      const archive = validateHostedArchive(repairedArchive.value);
      if (localArchive.repaired || repairedArchive.repaired) {
        await writeFile(root, ARCHIVE_FILENAME, JSON.stringify(archive));
      }
      return archive;
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
      const localArchive = reconcileLocalBootstrapSessions(
        JSON.parse(await (await handle.getFile()).text()),
      );
      const repairedArchive = discardInvalidBootstrapProjection(localArchive.value);
      const archive = validateHostedArchive(repairedArchive.value);
      await this.writeArchive(archive);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }
}

function reconcileLocalBootstrapSessions(value) {
  if (
    !isRecord(value) ||
    !Array.isArray(value.sessions) ||
    !isRecord(value.bootstrap) ||
    !Array.isArray(value.bootstrap.sessions)
  ) {
    return { value, repaired: false };
  }

  const archiveSessionIds = new Set();
  for (const session of value.sessions) {
    if (!isRecord(session) || typeof session.content !== "string") {
      return { value, repaired: false };
    }
    archiveSessionIds.add(validateSessionContent(session.content));
  }

  const sessions = [];
  for (const session of value.bootstrap.sessions) {
    if (
      !isRecord(session) ||
      typeof session.id !== "string" ||
      !session.id ||
      session.id.length > 220 ||
      (session.name !== undefined && typeof session.name !== "string")
    ) {
      return { value, repaired: false };
    }
    if (archiveSessionIds.has(session.id)) sessions.push(session);
  }
  const bootstrapSessionId = value.bootstrap.sessionId;
  const snapshotSessionId = isRecord(value.bootstrap.snapshot)
    ? value.bootstrap.snapshot.sessionId
    : undefined;
  const currentSessionMatches =
    typeof bootstrapSessionId === "string" &&
    (!bootstrapSessionId || archiveSessionIds.has(bootstrapSessionId));
  const projectionMatches =
    snapshotSessionId === undefined || snapshotSessionId === bootstrapSessionId;

  // The archive's JSONL sessions are durable; the bootstrap is only a cached
  // read-only projection for offline startup. If a previous build left that
  // projection pointing at a removed session, do not let it prevent an online
  // boot or leak a transient validation error to the UI. The next successful
  // bootstrap will write a fresh projection from the durable session files.
  if (!currentSessionMatches || !projectionMatches) {
    const { bootstrap: _bootstrap, ...archive } = value;
    return { value: archive, repaired: true };
  }
  if (sessions.length === value.bootstrap.sessions.length) {
    return { value, repaired: false };
  }
  return {
    value: { ...value, bootstrap: { ...value.bootstrap, sessions } },
    repaired: true,
  };
}

function discardInvalidBootstrapProjection(value) {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, "bootstrap")) {
    return { value, repaired: false };
  }
  try {
    validateHostedArchive(value);
    return { value, repaired: false };
  } catch (error) {
    // The bootstrap payload is a regenerated offline projection. It has no
    // authority over the canonical JSONL and SQLite checkpoint, so a stale
    // projection from an older build (or one that was interrupted mid-write)
    // must not make durable browser state impossible to load.
    if (!(error instanceof Error) || !error.message.startsWith("Offline bootstrap snapshot")) {
      throw error;
    }
    const { bootstrap: _bootstrap, ...archive } = value;
    validateHostedArchive(archive);
    return { value: archive, repaired: true };
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
    for (const [table, expectedColumns] of Object.entries(REQUIRED_STATE_COLUMNS)) {
      validateTableColumns(database, table, expectedColumns);
    }
    for (const requirement of VERSIONED_STATE_COLUMNS) {
      if (version >= requirement.since) {
        validateTableColumns(database, requirement.table, requirement.columns);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("State snapshot")) throw error;
    throw new Error("State snapshot is not a valid OpenCandle SQLite database");
  } finally {
    database?.close();
  }
}

function validateTableColumns(database, table, expectedColumns) {
  const result = database.exec(`PRAGMA table_info(${table})`);
  const columns = new Set(result[0]?.values.map((row) => row[1]));
  if (expectedColumns.some((column) => !columns.has(column))) {
    throw new Error(`State snapshot schema is missing required ${table} columns`);
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
      ...(session.actionStore ? { actionStore: session.actionStore } : {}),
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
    if (session.actionStore !== undefined) validateActionStore(session.actionStore);
    if (filenames.has(session.filename) || sessionIds.has(sessionId)) {
      throw new Error("Duplicate session identity in hosted archive");
    }
    filenames.add(session.filename);
    sessionIds.add(sessionId);
  }
  if (typeof value.stateBase64 !== "string") throw new Error("State snapshot is invalid");
  if (value.stateBase64) validateStateBytes(decodeStateBase64(value.stateBase64));
  if (typeof value.currentSessionId !== "string" || value.currentSessionId.length > 220) {
    throw new Error("Current session identity is invalid");
  }
  if (value.currentSessionId && !sessionIds.has(value.currentSessionId)) {
    throw new Error("Current session is absent from hosted archive");
  }
  if (value.bootstrap !== undefined) {
    validateBootstrap(value.bootstrap, value.currentSessionId, sessionIds);
  }
  if (byteLength(JSON.stringify(value)) > MAX_ARCHIVE_BYTES) {
    throw new Error("Hosted archive is too large");
  }
  return value;
}

function validateActionStore(content) {
  if (typeof content !== "string" || byteLength(content) > MAX_ACTION_STORE_BYTES) {
    throw new Error("Session action snapshot size is invalid");
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Session action snapshot is not valid JSON");
  }
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.acceptedActionIds) ||
    !Array.isArray(parsed.pendingActionIds) ||
    parsed.acceptedActionIds.length > 500 ||
    parsed.pendingActionIds.length > 500 ||
    parsed.acceptedActionIds.some((id) => typeof id !== "string") ||
    parsed.pendingActionIds.some(
      (entry) =>
        !isRecord(entry) ||
        typeof entry.id !== "string" ||
        !Number.isSafeInteger(entry.pendingAtMs) ||
        entry.pendingAtMs < 0 ||
        entry.pendingAtMs > Date.now() + MAX_ACTION_TIMESTAMP_SKEW_MS,
    ) ||
    (parsed.actionFingerprints !== undefined &&
      (!isRecord(parsed.actionFingerprints) ||
        Object.keys(parsed.actionFingerprints).length > 1_000 ||
        Object.values(parsed.actionFingerprints).some(
          (fingerprint) => typeof fingerprint !== "string" || fingerprint.length > 256,
        )))
  ) {
    throw new Error("Session action snapshot shape is invalid");
  }
}

export function decodeHostedArchive(value) {
  const archive = validateHostedArchive(value);
  return {
    sessions: archive.sessions.map((session) => ({ ...session })),
    stateBytes: archive.stateBase64 ? decodeStateBase64(archive.stateBase64) : undefined,
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
  const snapshot = isRecord(value.snapshot) ? value.snapshot : {};
  const catalog = isRecord(value.catalog) ? value.catalog : {};
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
    snapshot: {
      sessionId: stringOrEmpty(snapshot.sessionId) || stringOrEmpty(value.sessionId),
      entries: safeArray(snapshot.entries),
      events: safeArray(snapshot.events),
      state: isRecord(snapshot.state) ? structuredClone(snapshot.state) : {},
    },
    marketState: isRecord(value.marketState) ? structuredClone(value.marketState) : undefined,
    coordination: isRecord(value.coordination) ? value.coordination : {},
    catalog: {
      tools: safeArray(catalog.tools),
      workflows: safeArray(catalog.workflows),
      providers: safeArray(catalog.providers),
    },
    modelSetup,
    supportsSessionActions: value.supportsSessionActions !== false,
  });
}

function validateBootstrap(value, currentSessionId, archiveSessionIds) {
  if (!isRecord(value) || typeof value.sessionId !== "string" || !Array.isArray(value.sessions)) {
    throw new Error("Offline bootstrap snapshot is invalid: missing session metadata");
  }
  if (value.sessionId.length > 220) {
    throw new Error("Offline bootstrap snapshot is invalid: session identity is too long");
  }
  if (currentSessionId && value.sessionId !== currentSessionId) {
    throw new Error("Offline bootstrap snapshot is invalid: current session identity disagrees");
  }
  if (value.sessionId && !archiveSessionIds.has(value.sessionId)) {
    throw new Error("Offline bootstrap snapshot is invalid: current session file is missing");
  }
  if (typeof value.role !== "string") {
    throw new Error("Offline bootstrap snapshot is invalid: runtime role is missing");
  }
  if (
    value.sessions.some(
      (session) =>
        !isRecord(session) ||
        typeof session.id !== "string" ||
        !session.id ||
        session.id.length > 220 ||
        !archiveSessionIds.has(session.id) ||
        (session.name !== undefined && typeof session.name !== "string"),
    )
  ) {
    throw new Error("Offline bootstrap snapshot is invalid: saved session list disagrees");
  }
  if (!isRecord(value.snapshot)) {
    throw new Error("Offline bootstrap snapshot is invalid: session projection is missing");
  }
  if (value.snapshot.sessionId !== undefined && value.snapshot.sessionId !== value.sessionId) {
    throw new Error("Offline bootstrap snapshot is invalid: projected session identity disagrees");
  }
  if (!Array.isArray(value.snapshot.entries) || !Array.isArray(value.snapshot.events)) {
    throw new Error("Offline bootstrap snapshot is invalid: transcript projection is malformed");
  }
  if (!isRecord(value.snapshot.state)) {
    throw new Error("Offline bootstrap snapshot is invalid: dashboard projection is malformed");
  }
  if (value.marketState !== undefined && !isRecord(value.marketState)) {
    throw new Error("Offline bootstrap snapshot is invalid: market state is malformed");
  }
  if (
    !isRecord(value.coordination) ||
    (value.coordination.writable !== undefined &&
      typeof value.coordination.writable !== "boolean")
  ) {
    throw new Error("Offline bootstrap snapshot is invalid: coordination state is malformed");
  }
  if (
    !isRecord(value.catalog) ||
    !Array.isArray(value.catalog.tools) ||
    !Array.isArray(value.catalog.workflows) ||
    !Array.isArray(value.catalog.providers)
  ) {
    throw new Error("Offline bootstrap snapshot is invalid: capability catalog is malformed");
  }
  if (
    value.supportsSessionActions !== undefined &&
    typeof value.supportsSessionActions !== "boolean"
  ) {
    throw new Error("Offline bootstrap snapshot is invalid: session action state is malformed");
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

function mergeCheckpointMarketState(bootstrap, marketState) {
  if (!bootstrap || !isRecord(marketState)) return bootstrap;
  return { ...bootstrap, marketState: structuredClone(marketState) };
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

export function decodeStateBase64(value, maxBytes = MAX_STATE_BYTES) {
  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4;
  if (
    typeof value !== "string" ||
    value.length > maxEncodedLength ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new Error("State snapshot size or base64 encoding is invalid");
  }
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error("State snapshot is not valid base64");
  }
}

const decodeBase64 = decodeStateBase64;

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
