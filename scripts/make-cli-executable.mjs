#!/usr/bin/env node

import { chmodSync } from "node:fs";
import { resolve } from "node:path";

export function makeCliExecutable({
  platform = process.platform,
  chmod = chmodSync,
  path = resolve(import.meta.dirname, "..", "dist", "cli.js"),
} = {}) {
  if (platform === "win32") return;
  chmod(path, 0o755);
}

makeCliExecutable();
