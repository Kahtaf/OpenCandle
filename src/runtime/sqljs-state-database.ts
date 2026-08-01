import type { BindParams, Database, SqlJsStatic, SqlValue } from "sql.js";
import { initializeStateDatabase } from "../memory/sqlite.js";
import type { StateDatabase, StateRunResult, StateStatement } from "./state-database.js";

export class SqlJsStateDatabase implements StateDatabase {
  constructor(private readonly database: Database) {}

  prepare<BindParameters extends unknown[] | object = unknown[], Result = unknown>(
    source: string,
  ): BindParameters extends unknown[]
    ? StateStatement<BindParameters, Result>
    : StateStatement<[BindParameters], Result> {
    return new SqlJsStateStatement(
      this.database,
      source,
    ) as unknown as BindParameters extends unknown[]
      ? StateStatement<BindParameters, Result>
      : StateStatement<[BindParameters], Result>;
  }

  transaction<Result>(fn: () => Result): () => Result {
    return () => {
      this.database.run("BEGIN");
      try {
        const result = fn();
        this.database.run("COMMIT");
        return result;
      } catch (error) {
        this.database.run("ROLLBACK");
        throw error;
      }
    };
  }

  exec(source: string): this {
    this.database.exec(source);
    return this;
  }

  pragma(source: string, options?: { simple?: boolean }): unknown {
    const results = this.database.exec(`PRAGMA ${source}`);
    const first = results[0];
    if (!first) return options?.simple ? undefined : [];
    if (options?.simple) return first.values[0]?.[0];
    return first.values.map((values) =>
      Object.fromEntries(first.columns.map((column, index) => [column, values[index]])),
    );
  }

  exportBytes(): Uint8Array {
    const bytes = this.database.export();
    // sql.js closes/reopens its internal database during export(), resetting
    // connection-local pragmas such as foreign_keys.
    this.pragma("foreign_keys = ON");
    return bytes;
  }

  close(): this {
    this.database.close();
    return this;
  }
}

export function createSqlJsStateDatabaseWithModule(
  sql: SqlJsStatic,
  bytes?: Uint8Array,
): SqlJsStateDatabase {
  const database = new SqlJsStateDatabase(new sql.Database(bytes));
  database.pragma("foreign_keys = ON");
  initializeStateDatabase(database);
  return database;
}

class SqlJsStateStatement implements StateStatement {
  constructor(
    private readonly database: Database,
    private readonly source: string,
  ) {}

  run(...params: unknown[]): StateRunResult {
    this.database.run(this.source, normalizeParameters(params));
    const changes = this.database.getRowsModified();
    const lastInsertRowid =
      this.database.exec("SELECT last_insert_rowid() AS id")[0]?.values[0]?.[0] ?? 0;
    return {
      changes,
      lastInsertRowid:
        typeof lastInsertRowid === "number" ? lastInsertRowid : Number(lastInsertRowid),
    };
  }

  get(...params: unknown[]): unknown {
    const statement = this.database.prepare(this.source);
    try {
      statement.bind(normalizeParameters(params));
      if (!statement.step()) return undefined;
      return statement.getAsObject();
    } finally {
      statement.free();
    }
  }

  all(...params: unknown[]): unknown[] {
    const statement = this.database.prepare(this.source);
    const rows: unknown[] = [];
    try {
      statement.bind(normalizeParameters(params));
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }
}

function normalizeParameters(params: unknown[]): BindParams {
  if (params.length === 1 && isPlainObject(params[0])) {
    return Object.fromEntries(
      Object.entries(params[0]).map(([key, value]) => [
        /^[$:@]/.test(key) ? key : `$${key}`,
        normalizeValue(value),
      ]),
    );
  }
  return params.map(normalizeValue);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
  );
}

function normalizeValue(value: unknown): SqlValue {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "string" ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  if (value === undefined) return null;
  throw new Error(`Unsupported SQLite bind parameter: ${typeof value}`);
}
