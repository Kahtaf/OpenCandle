/**
 * The synchronous SQLite surface used by OpenCandle's durable state services.
 *
 * Runtime compositions provide the implementation:
 * - local TUI and local web use better-sqlite3;
 * - hosted web uses a synchronous WASM SQLite adapter inside browser-hosted Node.
 *
 * Keeping this contract structural prevents shared memory and market-state code
 * from importing a native addon.
 */
export interface StateStatement<BindParameters extends unknown[] = unknown[], Result = unknown> {
  run(...params: BindParameters): StateRunResult;
  get(...params: BindParameters): Result | undefined;
  all(...params: BindParameters): Result[];
}

export interface StateRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface StateDatabase {
  prepare<BindParameters extends unknown[] | object = unknown[], Result = unknown>(
    source: string,
  ): BindParameters extends unknown[]
    ? StateStatement<BindParameters, Result>
    : StateStatement<[BindParameters], Result>;
  transaction<Result>(fn: () => Result): () => Result;
  exec(source: string): StateDatabase;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  close(): StateDatabase;
}

/**
 * Compile-time adapter for structurally compatible synchronous SQLite drivers.
 * It deliberately adds no runtime wrapper or per-query overhead.
 */
export function asStateDatabase(database: StateDatabase): StateDatabase {
  return database;
}
