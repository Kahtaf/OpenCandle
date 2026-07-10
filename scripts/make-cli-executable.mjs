#!/usr/bin/env node

import { chmodSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function makeCliExecutable({
  platform = process.platform,
  chmod = chmodSync,
  path = resolve(import.meta.dirname, "..", "dist", "cli.js"),
} = {}) {
  if (platform === "win32") return;
  chmod(path, 0o755);
}

// Only run when executed as a script; importing (e.g. from tests) must not
// touch dist/, which may not exist yet in a clean checkout.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  makeCliExecutable();
}
