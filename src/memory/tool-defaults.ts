import type { StateDatabase } from "../runtime/state-database.js";
import { initDefaultDatabase } from "./sqlite.js";

export type ToolDefaults = Record<string, unknown>;

/**
 * One `tool_defaults` row. `getAllDefaults` folds parameter paths into nested
 * objects for tool execution; the settings list needs the stored path and time
 * back, so it reads flat rows instead.
 */
export interface StoredToolDefault {
  toolName: string;
  paramPath: string;
  value: unknown;
  setAt: string;
}

// User-facing delete surfaces call this before removing a row. The __enabled
// rows are tool on/off bookkeeping: deleting a false row would silently
// re-enable a disabled tool, so they are not deletable as defaults.
export function assertUserDeletableToolDefaultPath(paramPath: string): void {
  if (paramPath === "__enabled") {
    throw new Error("This row controls whether a tool is enabled and cannot be deleted here.");
  }
}

export function listAllToolDefaults(db?: StateDatabase): StoredToolDefault[] {
  const ownedDb = db == null;
  const connection = db ?? initDefaultDatabase();
  try {
    const rows = connection
      .prepare(
        // The __enabled rows are tool on/off bookkeeping written by
        // setToolEnabled, not user-facing defaults; listing them would let a
        // preferences delete silently re-enable a disabled tool.
        `SELECT tool_name, param_path, value_json, set_at FROM tool_defaults
         WHERE param_path != '__enabled' ORDER BY tool_name, param_path`,
      )
      .all() as Array<{
      tool_name: string;
      param_path: string;
      value_json: string;
      set_at: string;
    }>;

    return rows.map((row) => ({
      toolName: row.tool_name,
      paramPath: row.param_path,
      value: parseStoredValue(row.value_json),
      setAt: String(row.set_at ?? ""),
    }));
  } finally {
    if (ownedDb) connection.close();
  }
}

export function getDefaults(toolName: string, db?: StateDatabase): ToolDefaults {
  const ownedDb = db == null;
  const connection = db ?? initDefaultDatabase();
  try {
    const rows = connection
      .prepare(
        `SELECT param_path, value_json FROM tool_defaults WHERE tool_name = ? ORDER BY param_path`,
      )
      .all(toolName) as Array<{ param_path: string; value_json: string }>;

    const defaults: ToolDefaults = {};
    for (const row of rows) {
      setPath(defaults, row.param_path, parseStoredValue(row.value_json));
    }
    return defaults;
  } finally {
    if (ownedDb) connection.close();
  }
}

export function getAllDefaults(db?: StateDatabase): Map<string, ToolDefaults> {
  const ownedDb = db == null;
  const connection = db ?? initDefaultDatabase();
  try {
    const rows = connection
      .prepare(
        `SELECT tool_name, param_path, value_json FROM tool_defaults ORDER BY tool_name, param_path`,
      )
      .all() as Array<{ tool_name: string; param_path: string; value_json: string }>;

    const groups = new Map<string, ToolDefaults>();
    for (const row of rows) {
      const defaults = groups.get(row.tool_name) ?? {};
      setPath(defaults, row.param_path, parseStoredValue(row.value_json));
      groups.set(row.tool_name, defaults);
    }
    return groups;
  } finally {
    if (ownedDb) connection.close();
  }
}

export function setDefault(
  toolName: string,
  paramPath: string,
  value: unknown,
  db?: StateDatabase,
): void {
  const ownedDb = db == null;
  const connection = db ?? initDefaultDatabase();
  try {
    connection
      .prepare(
        `INSERT INTO tool_defaults (tool_name, param_path, value_json, set_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(tool_name, param_path) DO UPDATE SET
         value_json = excluded.value_json,
         set_at = excluded.set_at`,
      )
      .run(toolName, paramPath, JSON.stringify(value), new Date().toISOString());
  } finally {
    if (ownedDb) connection.close();
  }
}

/** Removes one stored default. Returns whether a row was actually removed. */
export function deleteDefault(toolName: string, paramPath: string, db?: StateDatabase): boolean {
  const ownedDb = db == null;
  const connection = db ?? initDefaultDatabase();
  try {
    const result = connection
      .prepare(`DELETE FROM tool_defaults WHERE tool_name = ? AND param_path = ?`)
      .run(toolName, paramPath);
    return result.changes > 0;
  } finally {
    if (ownedDb) connection.close();
  }
}

export function clearDefault(toolName: string, paramPath: string, db?: StateDatabase): void {
  deleteDefault(toolName, paramPath, db);
}

function parseStoredValue(valueJson: string): unknown {
  try {
    return JSON.parse(valueJson);
  } catch {
    return valueJson;
  }
}

function setPath(target: ToolDefaults, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return;

  let cursor: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part];
    if (!isPlainObject(existing)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
