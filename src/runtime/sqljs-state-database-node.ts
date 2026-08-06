import initSqlJs, { type SqlJsStatic } from "sql.js";
import {
  createSqlJsStateDatabaseWithModule,
  type SqlJsStateDatabase,
} from "./sqljs-state-database.js";

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

export async function createSqlJsStateDatabase(bytes?: Uint8Array): Promise<SqlJsStateDatabase> {
  sqlJsPromise ??= initSqlJs();
  return createSqlJsStateDatabaseWithModule(await sqlJsPromise, bytes);
}
