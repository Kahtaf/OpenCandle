#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tempOut = join(root, ".tmp", "gui-server-build");
const finalOut = join(root, "dist", "gui");
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

rmSync(tempOut, { recursive: true, force: true });
rmSync(finalOut, { recursive: true, force: true });

execFileSync(
  npxCommand,
  [
    "tsc",
    "--ignoreConfig",
    "--noCheck",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--outDir",
    tempOut,
    "--rootDir",
    ".",
    "--declaration",
    "--resolveJsonModule",
    "--forceConsistentCasingInFileNames",
    "gui/server/server.ts",
    "gui/shared/chat-events.ts",
    "gui/shared/event-reducer.ts",
  ],
  { cwd: root, stdio: "inherit" },
);

cpSync(join(tempOut, "gui"), finalOut, { recursive: true });
rewriteCompiledImports(finalOut);
rmSync(tempOut, { recursive: true, force: true });

function rewriteCompiledImports(dir) {
  for (const entry of listFiles(dir)) {
    if (!entry.endsWith(".js") && !entry.endsWith(".d.ts")) continue;
    const source = readFileSync(entry, "utf8");
    const rewritten = source.replaceAll('"../../src/', '"../../');
    if (rewritten !== source) writeFileSync(entry, rewritten, "utf8");
  }
}

function listFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      files.push(...listFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}
