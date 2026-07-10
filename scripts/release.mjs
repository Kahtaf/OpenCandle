#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  addUnreleasedSection,
  confirmReleaseEvals,
  updateChangelogForRelease,
} from "./release-lib.mjs";

const args = process.argv.slice(2);
const bumpType = args.find((arg) => !arg.startsWith("-"));
const skipEvalConfirm = args.includes("--skip-eval-confirm");
const supportedBumpTypes = new Set(["major", "minor", "patch"]);

if (!supportedBumpTypes.has(bumpType)) {
  console.error("Usage: node scripts/release.mjs <major|minor|patch> [--skip-eval-confirm]");
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
  } catch (_error) {
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

function capture(cmd) {
  return run(cmd, { silent: true })?.trim() ?? "";
}

function commandSucceeds(cmd) {
  try {
    execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function assertMainBranch() {
  const branch = capture("git branch --show-current");
  if (branch !== "main") {
    fail(`Release must run from main, not ${branch || "detached HEAD"}.`);
  }
}

function assertHeadMatchesOriginMain() {
  const head = capture("git rev-parse HEAD");
  const originMain = capture("git rev-parse origin/main");
  if (head !== originMain) {
    fail("Local main is not up to date with origin/main. Pull or rebase before releasing.");
  }
}

function assertTagAvailable(version) {
  const tag = `v${version}`;
  if (commandSucceeds(`git rev-parse -q --verify refs/tags/${tag}`)) {
    fail(`Tag ${tag} already exists locally.`);
  }
  if (commandSucceeds(`git ls-remote --exit-code --tags origin refs/tags/${tag}`)) {
    fail(`Tag ${tag} already exists on origin.`);
  }
}

console.log("\n=== Release Script ===\n");

console.log("Checking for uncommitted changes...");
const status = run("git status --porcelain", { silent: true });
if (status?.trim()) {
  console.error("Error: Uncommitted changes detected. Commit or stash first.");
  console.error(status);
  process.exit(1);
}
console.log(" Working directory clean\n");

console.log("Checking release branch and remote state...");
assertMainBranch();
run("git fetch origin main:refs/remotes/origin/main --tags");
assertHeadMatchesOriginMain();
console.log(" Release branch is current\n");

console.log("Running release preflight...");
run("npm run release:check");
console.log(" Release preflight passed\n");

if (!(await confirmReleaseEvals({ skip: skipEvalConfirm }))) {
  fail("Release eval confirmation not received. Aborting before version or tag mutation.");
}
console.log();

console.log(`Bumping version (${bumpType})...`);
run(`npm run version:${bumpType}`);
const version = getVersion();
console.log(` New version: ${version}\n`);

assertTagAvailable(version);

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
