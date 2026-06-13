import {
  ensureNativeDependency,
  getUnsupportedNodeVersionMessage,
} from "./check-node-version-lib.mjs";

const nodeVersionMessage = getUnsupportedNodeVersionMessage();
if (nodeVersionMessage) {
  console.error(nodeVersionMessage);
  process.exit(1);
}

async function loadBetterSqlite3() {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  db.close();
}

try {
  await ensureNativeDependency({
    dependencyName: "better-sqlite3",
    load: loadBetterSqlite3,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
