#!/usr/bin/env node

import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const deniedDirectorySegments = new Set([
  ".agents",
  ".claude",
  ".codex",
  "design-inspo",
  "docs",
  "dogfood-output",
  "fixtures",
  "graphify-out",
  "openspec",
  "plans",
  "src",
  "tests",
  "validation-output",
]);

const deniedPathSequences = [
  ["gui", "server"],
  ["gui", "shared"],
  ["website", "dist"],
];

const requiredFiles = [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/cli.js",
  "dist/index.js",
  "dist/gui/server/server.js",
  "assets/logo.svg",
  "gui/web/dist/index.html",
];

function runPackDryRun() {
  const output = execSync("npm pack --dry-run --json", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const packs = parsePackDryRunJson(output);
  if (!Array.isArray(packs) || packs.length === 0) {
    throw new Error("npm pack --dry-run --json did not return package metadata.");
  }
  return packs[0].files.map((file) => file.path).sort();
}

export function parsePackDryRunJson(output) {
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== "[") continue;
    try {
      return JSON.parse(output.slice(index));
    } catch {
      // npm lifecycle script output can precede the JSON payload.
    }
  }
  throw new Error("Could not parse npm pack --dry-run --json output.");
}

function startsWithPathSequence(segments, sequence) {
  return sequence.every((segment, index) => segments[index] === segment);
}

export function isDeniedPackagePath(path) {
  const segments = path.split("/").filter(Boolean);
  return (
    segments.some((segment) => deniedDirectorySegments.has(segment)) ||
    segments.some((segment) => /^\.env(?:$|\.)/.test(segment)) ||
    deniedPathSequences.some((sequence) => startsWithPathSequence(segments, sequence))
  );
}

function main() {
  const files = runPackDryRun();
  const fileSet = new Set(files);
  const denied = files.filter(isDeniedPackagePath);
  const missing = requiredFiles.filter((file) => !fileSet.has(file));

  if (denied.length > 0 || missing.length > 0) {
    if (denied.length > 0) {
      console.error("Package contains denied release artifacts:");
      for (const path of denied) console.error(`  ${path}`);
    }
    if (missing.length > 0) {
      console.error("Package is missing required runtime files:");
      for (const path of missing) console.error(`  ${path}`);
    }
    process.exit(1);
  }

  console.log(`Package contents check passed for ${files.length} file(s).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
