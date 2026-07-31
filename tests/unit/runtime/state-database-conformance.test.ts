import { describe } from "vitest";
import { initDatabase } from "../../../src/memory/sqlite.js";
import { createSqlJsStateDatabase } from "../../../src/runtime/sqljs-state-database-node.js";
import { runStateDatabaseConformance } from "./state-database-conformance.js";

describe("native StateDatabase conformance", () => {
  runStateDatabaseConformance(() => initDatabase(":memory:"));
});

describe("WASM StateDatabase conformance", () => {
  runStateDatabaseConformance(() => createSqlJsStateDatabase());
});
