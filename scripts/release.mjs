#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { addUnreleasedSection, updateChangelogForRelease } from "./release-lib.mjs";

const bumpType = process.argv[2];
const supportedBumpTypes = new Set(["major", "minor", "patch"]);

if (!supportedBumpTypes.has(bumpType)) {
  console.error("Usage: node scripts/release.mjs <major|minor|patch>");
  process.exit(1);
}

function run(cmd, options = {}) {
  console.log(`$ ${cmd}`);
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      stdio: options.silent ? "pipe" : "inherit",
      ...options,
    });
  } catch (error) {
    if (!options.ignoreError) {
      console.error(`Command failed: ${cmd}`);
      process.exit(1);
    }
    return null;
  }
}

function getVersion() {
  const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
  return pkg.version;
}

console.log("\n=== Release Script ===\n");

console.log("Checking for uncommitted changes...");
const status = run("git status --porcelain", { silent: true });
if (status && status.trim()) {
  console.error("Error: Uncommitted changes detected. Commit or stash first.");
  console.error(status);
  process.exit(1);
}
console.log(" Working directory clean\n");

console.log(`Bumping version (${bumpType})...`);
run(`npm run version:${bumpType}`);
const version = getVersion();
console.log(` New version: ${version}\n`);

console.log("Updating CHANGELOG.md...");
updateChangelogForRelease("CHANGELOG.md", version);
console.log(" Updated CHANGELOG.md\n");

console.log("Committing and tagging...");
run("git add package.json package-lock.json CHANGELOG.md");
run(`git commit -m "Release v${version}"`);
run(`git tag v${version}`);
console.log();

console.log("Adding [Unreleased] section for next cycle...");
addUnreleasedSection("CHANGELOG.md");
console.log(" Updated CHANGELOG.md\n");

console.log("Committing changelog reset...");
run("git add CHANGELOG.md");
run('git commit -m "Add [Unreleased] section for next cycle"');
console.log();

console.log("Pushing to remote...");
run("git push origin main");
run(`git push origin v${version}`);
console.log();

console.log("GitHub Actions will publish the tagged release to npm.");
console.log();

console.log(`=== Prepared release v${version} ===`);
