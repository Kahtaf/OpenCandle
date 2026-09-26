#!/usr/bin/env node

import { createReleaseDeps, parseReleaseArgs, runLocalRelease } from "./release-lib.mjs";

const parsed = parseReleaseArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`Error: ${parsed.error}`);
  console.error("Usage: node scripts/release.mjs <major|minor|patch> [--dry-run]");
  console.error("       node scripts/release.mjs --resume [--dry-run]");
  process.exit(1);
}

console.log("\n=== Release Script ===\n");

const result = runLocalRelease({
  bumpType: parsed.bumpType,
  resume: parsed.resume,
  dryRun: parsed.dryRun,
  deps: createReleaseDeps({}),
});

if (!result.ok) {
  console.error(`\nError (${result.stage}): ${result.error}`);
  console.error(`\n${result.recovery}`);
  process.exit(1);
}

if (result.dryRun) {
  console.log("\n=== Dry run complete: no changes, no commands with credentials ===");
} else {
  console.log(`\n=== Pushed release v${result.version} ===`);
  console.log("\nThe tag workflow will publish to npm only after fresh live evals pass.");
}
