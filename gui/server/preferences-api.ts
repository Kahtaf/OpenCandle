import type Database from "better-sqlite3";
import {
  buildPreferencesSnapshot,
  type PreferencesSnapshot,
} from "../../src/memory/preferences-view.js";
import { initDefaultDatabase } from "../../src/memory/sqlite.js";
import { MemoryStorage } from "../../src/memory/storage.js";
import {
  assertUserDeletableToolDefaultPath,
  deleteDefault,
} from "../../src/memory/tool-defaults.js";

export type { PreferencesSnapshot };

const MAX_IDENTIFIER_LENGTH = 200;

export function getPreferencesSnapshot(db?: Database.Database): PreferencesSnapshot {
  return withDatabase(db, (connection) => buildPreferencesSnapshot(connection));
}

export function deleteStoredPreference(
  namespace: string,
  key: string,
  db?: Database.Database,
): PreferencesSnapshot {
  const storedNamespace = requireIdentifier(namespace, "Preference namespace");
  const storedKey = requireIdentifier(key, "Preference key");
  return withDatabase(db, (connection) => {
    // Deletion is idempotent: a second window may have removed the same row
    // already, and the caller only needs the resulting state.
    new MemoryStorage(connection).deletePreference(storedNamespace, storedKey);
    return buildPreferencesSnapshot(connection);
  });
}

export function deleteStoredToolDefault(
  toolName: string,
  paramPath: string,
  db?: Database.Database,
): PreferencesSnapshot {
  const storedToolName = requireIdentifier(toolName, "Tool name");
  const storedParamPath = requireIdentifier(paramPath, "Parameter path");
  assertUserDeletableToolDefaultPath(storedParamPath);
  return withDatabase(db, (connection) => {
    deleteDefault(storedToolName, storedParamPath, connection);
    return buildPreferencesSnapshot(connection);
  });
}

function withDatabase<Result>(
  db: Database.Database | undefined,
  read: (connection: Database.Database) => Result,
): Result {
  const connection = db ?? initDefaultDatabase();
  try {
    return read(connection);
  } finally {
    if (!db) connection.close();
  }
}

function requireIdentifier(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`${label} is required.`);
  }
  return text;
}
