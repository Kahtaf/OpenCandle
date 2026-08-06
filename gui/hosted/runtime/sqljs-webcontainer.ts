import { createRequire } from "node:module";
import type initSqlJsType from "sql.js";

const require = createRequire(import.meta.url);
const initSqlJs = require("./sql-wasm.cjs") as typeof initSqlJsType;

export default initSqlJs;
