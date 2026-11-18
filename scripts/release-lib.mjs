import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildNpmInvocation } from "./npm-command.mjs";

const BUMP_TYPES = new Set(["major", "minor", "patch"]);

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function bumpSemver(version, bumpType) {
  const parsed = parseSemver(version);
  if (!parsed) throw new Error(`Cannot bump non-semver version "${version}"`);
  const [major, minor, patch] = parsed;
  if (bumpType === "major") return `${major + 1}.0.0`;
  if (bumpType === "minor") return `${major}.${minor + 1}.0`;
  if (bumpType === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown bump type "${bumpType}"`);
}

export function updateChangelogForRelease(
  changelogPath,
  version,
  date = new Date().toISOString().split("T")[0],
) {
  const content = readFileSync(changelogPath, "utf-8");
  if (!content.includes("## [Unreleased]")) {
    throw new Error(`Missing [Unreleased] section in ${changelogPath}`);
  }
  writeFileSync(changelogPath, content.replace("## [Unreleased]", `## [${version}] - ${date}`));
}

export function addUnreleasedSection(changelogPath) {
  const content = readFileSync(changelogPath, "utf-8");
  if (content.includes("## [Unreleased]")) {
    return;
  }
  const updated = content.replace(/^(# Changelog\n\n)/, "$1## [Unreleased]\n\n");
  if (updated === content) {
    throw new Error(`Missing changelog header in ${changelogPath}`);
  }
  writeFileSync(changelogPath, updated);
}

export function parseReleaseArgs(argv) {
  const bumpTypes = argv.filter((arg) => arg !== "--dry-run");
  const [bumpType] = bumpTypes;
  if (bumpTypes.length !== 1 || !BUMP_TYPES.has(bumpType)) {
    return { ok: false, error: "Expected major|minor|patch and optional --dry-run" };
  }
  return { ok: true, bumpType, dryRun: argv.includes("--dry-run") };
}

export function prepareReleaseCandidate({
  bumpType,
  dryRun = false,
  deps,
  date = new Date().toISOString().split("T")[0],
}) {
  const version = bumpSemver(deps.readVersion(), bumpType);
  if (dryRun) return version;

  if (!deps.isWorkingTreeClean()) throw new Error("Release preparation requires a clean tree");
  const branch = deps.currentBranch();
  if (!branch || branch === "main") {
    throw new Error("Create a version PR branch from origin/main before preparing a release");
  }
  if (deps.fetchOriginMain() !== 0 || deps.headSha() !== deps.originMainSha()) {
    throw new Error("Release preparation requires the current origin/main commit");
  }
  if (deps.tagExists(`v${version}`)) throw new Error(`Tag v${version} already exists`);
  if (deps.runBump(bumpType) !== 0) throw new Error("Version bump failed");
  deps.markChangelogReleased(version, date);
  if (deps.commitCandidate(version) !== 0) throw new Error("Version commit failed");
  return version;
}

function defaultRunner(cwd) {
  return (command, args, options = {}) => {
    // Windows ships npm/npx as `.cmd` shims that a `shell: false` spawn cannot
    // execute; route them through the Node entrypoint. git/node commands and an
    // injected runner are passed through unchanged.
    const invocation =
      command === "npm" || command === "npx"
        ? buildNpmInvocation(command, args)
        : { command, args };
    const result = spawnSync(invocation.command, invocation.args, {
      cwd,
      encoding: "utf8",
      shell: false,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    return {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };
}

export function createReleaseDeps({ cwd = process.cwd(), runner } = {}) {
  const run = runner ?? defaultRunner(cwd);
  const status = (command, args) => run(command, args)?.status ?? 1;
  const capture = (command, args) => {
    const result = run(command, args, { capture: true });
    if (result.status !== 0) {
      throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
    }
    return (result.stdout ?? "").trim();
  };
  const packageJsonPath = join(cwd, "package.json");
  const changelogPath = join(cwd, "CHANGELOG.md");

  return {
    isWorkingTreeClean: () => capture("git", ["status", "--porcelain"]) === "",
    currentBranch: () => capture("git", ["branch", "--show-current"]),
    headSha: () => capture("git", ["rev-parse", "HEAD"]),
    originMainSha: () => capture("git", ["rev-parse", "origin/main"]),
    fetchOriginMain: () =>
      status("git", ["fetch", "origin", "main:refs/remotes/origin/main", "--tags"]),
    tagExists: (tag) =>
      status("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]) === 0 ||
      status("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`]) === 0,
    readVersion: () => JSON.parse(readFileSync(packageJsonPath, "utf-8")).version,
    runBump: (bumpType) => status("npm", ["run", `version:${bumpType}`]),
    markChangelogReleased: (version, date) => {
      updateChangelogForRelease(changelogPath, version, date);
      addUnreleasedSection(changelogPath);
    },
    commitCandidate: (version) => {
      const added = status("git", ["add", "package.json", "package-lock.json", "CHANGELOG.md"]);
      if (added !== 0) return added;
      return status("git", ["commit", "-m", `Release v${version}`]);
    },
  };
}
