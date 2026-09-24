// Release orchestration library.
//
// The trusted publication model is: a release candidate is prepared and
// committed first, the full local gate and fresh live release evals run against
// that exact final candidate, and only then may the candidate be tagged and
// pushed. There is no eval-confirmation bypass and no way to skip proof.
//
// `runLocalRelease` is pure orchestration over an injected `deps` object so
// tests can assert ordering, failures, and the no-tag/no-push guarantee without
// running a real release. `createReleaseDeps` wires the real git/npm/spawn
// implementation used by the CLI.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BUMP_TYPES = new Set(["major", "minor", "patch"]);
const CANDIDATE_FILES = new Set(["package.json", "package-lock.json", "CHANGELOG.md"]);

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
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
  const bumpTypes = [];
  let resume = false;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--resume") {
      resume = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--skip-eval-confirm") {
      return {
        ok: false,
        error:
          "--skip-eval-confirm is no longer supported; the trusted workflow runs fresh release evals and cannot be bypassed",
      };
    } else if (arg.startsWith("-")) {
      return { ok: false, error: `unknown option "${arg}"` };
    } else if (BUMP_TYPES.has(arg)) {
      bumpTypes.push(arg);
    } else {
      return { ok: false, error: `unknown argument "${arg}"` };
    }
  }
  if (resume) {
    if (bumpTypes.length > 0) {
      return {
        ok: false,
        error: "--resume reads the version from the release commit and takes no bump type",
      };
    }
    return { ok: true, bumpType: null, resume: true, dryRun };
  }
  if (bumpTypes.length !== 1) {
    return { ok: false, error: "exactly one of major|minor|patch is required" };
  }
  return { ok: true, bumpType: bumpTypes[0], resume: false, dryRun };
}

function buildRecovery(state, stage) {
  const lines = [
    `State at failure (${stage}): candidate commit ${state.candidateCommitted ? "created" : "not created"}; version bump ${state.versionBumped ? "applied in the working tree" : "not applied"}; tag v${state.version ?? "?"} ${state.tagCreated ? "created locally" : "not created"}; changelog reset commit ${state.changelogResetCommitted ? "created" : "not created"}; main ${state.mainPushed ? "pushed" : "not pushed"}; tag ${state.tagPushed ? "pushed" : "not pushed"}.`,
    "This script performs no automatic rollback and never force-pushes.",
    "Inspect real state with: git status; git log --oneline -5; git tag --points-at HEAD; git rev-parse HEAD; git rev-parse origin/main; git ls-remote --tags origin.",
  ];
  if (state.tagCreated && !state.tagPushed) {
    lines.push(
      `The local tag v${state.version} was never pushed. If you intend to retry proof, inspect it and remove it manually: git tag -d v${state.version}`,
    );
  }
  if (state.mainPushed || state.tagPushed) {
    lines.push(
      "Remote state already changed; coordinate manual cleanup before any retry and do not force-push.",
    );
  } else if (state.candidateCommitted && !state.tagCreated) {
    lines.push("To rerun proof on the committed candidate: node scripts/release.mjs --resume");
  } else if (!state.candidateCommitted) {
    lines.push(
      "Resolve the failure, then rerun the release: node scripts/release.mjs <major|minor|patch>",
    );
  }
  return lines.join("\n");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a release-package `package-proof.json` before its tarball is
 * published. Returns the plain basename so callers can build a shell-quoted
 * path from an already-validated value instead of scanning for tarballs.
 */
export function validatePackageProof(proof, options = {}) {
  if (!isRecord(proof)) return { ok: false, error: "package proof must be an object" };
  const { packageName, packageVersion, candidateCommit, sha256 } = options;
  const tarball = proof.tarball;
  if (typeof tarball !== "string" || tarball.trim() === "") {
    return { ok: false, error: "package proof tarball must be a non-empty string" };
  }
  if (
    tarball !== tarball.split("/").pop() ||
    tarball.includes("\\") ||
    tarball === "." ||
    tarball === ".." ||
    tarball.startsWith(".")
  ) {
    return { ok: false, error: "package proof tarball must be a plain basename without traversal" };
  }
  const expectedTarball = `${String(packageName).replace(/^@/, "").replace("/", "-")}-${packageVersion}.tgz`;
  if (tarball !== expectedTarball) {
    return {
      ok: false,
      error: `package proof tarball ${tarball} does not match expected ${expectedTarball}`,
    };
  }
  if (typeof proof.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(proof.sha256)) {
    return { ok: false, error: "package proof sha256 must be a 64-character hex digest" };
  }
  if (typeof sha256 === "string" && sha256.toLowerCase() !== proof.sha256.toLowerCase()) {
    return { ok: false, error: "tarball sha256 does not match package proof" };
  }
  if (typeof candidateCommit === "string" && proof.candidateCommit !== candidateCommit) {
    return { ok: false, error: "package proof candidateCommit does not match HEAD" };
  }
  if (typeof proof.packageVersion === "string" && proof.packageVersion !== packageVersion) {
    return { ok: false, error: "package proof packageVersion does not match package.json" };
  }
  if (typeof proof.packageName === "string" && proof.packageName !== packageName) {
    return { ok: false, error: "package proof packageName does not match package.json" };
  }
  return { ok: true, tarball };
}

function verifyResumeCandidate(deps) {
  const head = deps.headSha();
  const origin = deps.originMainSha();
  if (head !== origin && deps.readHeadParentSha() !== origin) {
    return {
      ok: false,
      error: "HEAD is neither origin/main nor exactly one release candidate commit ahead",
    };
  }
  const match = /^Release v(\d+\.\d+\.\d+)$/.exec(deps.readHeadSubject().trim());
  if (!match) {
    return { ok: false, error: "HEAD is not a `Release v<major.minor.patch>` commit" };
  }
  const version = match[1];
  if (deps.readVersion() !== version) {
    return {
      ok: false,
      error: `package.json version does not match the release commit ${version}`,
    };
  }
  const parentVersion = deps.readVersionAt("HEAD~1");
  if (
    compareSemver(parentVersion, version) === null ||
    compareSemver(parentVersion, version) >= 0
  ) {
    return { ok: false, error: "parent commit version is not lower than the candidate version" };
  }
  const changelog = deps.readChangelog();
  if (!changelog.includes(`## [${version}]`)) {
    return { ok: false, error: `CHANGELOG.md is missing the ## [${version}] entry` };
  }
  if (changelog.includes("## [Unreleased]")) {
    return { ok: false, error: "CHANGELOG.md still has [Unreleased]; candidate is not prepared" };
  }
  const unexpected = deps.readHeadChangedFiles().filter((file) => !CANDIDATE_FILES.has(file));
  if (unexpected.length > 0) {
    return {
      ok: false,
      error: `release candidate changed unexpected files: ${unexpected.join(", ")}`,
    };
  }
  return { ok: true, version };
}

/**
 * Orchestrate a local release without performing it by itself; every effect
 * goes through `deps` so tests can inject recorders and failures. The proof
 * order is release:check -> prepare exact package -> fresh release evals, so no
 * expensive build happens after the freshness evidence is produced. Only after
 * every proof passes, the tree is clean, and HEAD is unchanged are the tag,
 * changelog reset, and pushes performed.
 *
 * @returns {{ ok: boolean, stage: string, version?: string|null, error?: string, state: object, recovery?: string, dryRun?: boolean }}
 */
export function runLocalRelease({
  bumpType = null,
  resume = false,
  dryRun = false,
  deps,
  date = new Date().toISOString().split("T")[0],
} = {}) {
  if (!deps) throw new Error("runLocalRelease requires a deps object");
  const state = {
    version: null,
    versionBumped: false,
    candidateCommitted: false,
    releaseCheckPassed: false,
    packagePrepared: false,
    providerReleasePassed: false,
    releaseEvalsPassed: false,
    releaseSummaryWritten: false,
    tagCreated: false,
    changelogResetCommitted: false,
    mainPushed: false,
    tagPushed: false,
  };
  let stage = "preflight";
  const snapshot = () => ({ ...state });
  const fail = (error) => ({
    ok: false,
    stage,
    error,
    version: state.version,
    state: snapshot(),
    recovery: buildRecovery(state, stage),
  });

  if (dryRun) {
    const next = resume ? deps.readVersion() : bumpSemver(deps.readVersion(), bumpType);
    deps.log(`dry-run: args valid; planned release version ${next}`);
    deps.log(
      "dry-run: would verify clean main at origin/main, prepare the candidate commit, run release:check, prepare the exact package, run the provider release smoke and fresh release evals, then tag, reset the changelog, and push only on success",
    );
    return { ok: true, dryRun: true, stage: "dry-run", version: next, state: snapshot() };
  }

  try {
    if (!deps.isWorkingTreeClean()) return fail("working tree is not clean");
    if (deps.currentBranch() !== "main") return fail("release must run from main");
    if (deps.fetchOriginMain() !== 0) return fail("could not fetch origin/main");

    if (resume) {
      stage = "resume-verify";
      const verified = verifyResumeCandidate(deps);
      if (!verified.ok) return fail(verified.error);
      state.version = verified.version;
      state.candidateCommitted = true;
    } else {
      if (deps.headSha() !== deps.originMainSha()) {
        return fail("main is not current with origin/main");
      }
      const next = bumpSemver(deps.readVersion(), bumpType);
      if (deps.tagExists(`v${next}`)) return fail(`tag v${next} already exists`);
      stage = "prepare";
      if (deps.runBump(bumpType) !== 0) return fail(`version bump (${bumpType}) failed`);
      state.versionBumped = true;
      state.version = deps.readVersion();
      deps.markChangelogReleased(state.version, date);
      if (deps.commitCandidate(state.version) !== 0) return fail("candidate commit failed");
      state.candidateCommitted = true;
    }

    const candidateHead = deps.headSha();

    stage = "release-check";
    if (deps.runReleaseCheck() !== 0) return fail("release:check failed on the candidate");
    state.releaseCheckPassed = true;
    deps.log("release:check passed on the final candidate");

    stage = "release-package";
    if (deps.prepareReleasePackage() !== 0) {
      return fail("release-package prepare failed on the candidate");
    }
    state.packagePrepared = true;
    deps.log("exact release package prepared on the final candidate");

    stage = "provider-release";
    if (deps.runProviderReleaseSmoke() !== 0) {
      return fail("provider release smoke failed on the candidate");
    }
    state.providerReleasePassed = true;
    deps.log("provider release smoke passed on the final candidate");

    stage = "release-evals";
    if (deps.runReleaseEvals() !== 0) return fail("fresh release evals failed on the candidate");
    state.releaseEvalsPassed = true;
    deps.log("fresh release evals passed on the final candidate");

    stage = "release-summary";
    if (deps.writeReleaseSummary() !== 0) {
      return fail("release summary aggregation failed on the candidate");
    }
    state.releaseSummaryWritten = true;
    deps.log("compact release summary written on the final candidate");

    stage = "finalize";
    if (!deps.isWorkingTreeClean()) return fail("candidate tree is not clean before tagging");
    if (deps.headSha() !== candidateHead) return fail("HEAD changed after proof; refusing to tag");
    if (deps.tagVersion(`v${state.version}`) !== 0) {
      return fail(`failed to create tag v${state.version}`);
    }
    state.tagCreated = true;
    deps.addUnreleasedSection();
    if (deps.commitChangelogReset() !== 0) return fail("changelog reset commit failed");
    state.changelogResetCommitted = true;
    if (deps.pushMain() !== 0) return fail("push main failed");
    state.mainPushed = true;
    if (deps.pushTag(`v${state.version}`) !== 0) {
      return fail(`push tag v${state.version} failed`);
    }
    state.tagPushed = true;

    return { ok: true, stage: "released", version: state.version, state: snapshot() };
  } catch (error) {
    // A thrown dep (for example markChangelogReleased) still has real side
    // effects, so report the accurate stage and state rather than implying a
    // clean slate.
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function defaultRunner(cwd) {
  return (command, args, options = {}) => {
    const result = spawnSync(command, args, {
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

export function createReleaseDeps({ cwd = process.cwd(), logger = console, runner } = {}) {
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
    log: (message) => logger.log(message),
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
    markChangelogReleased: (version, date) =>
      updateChangelogForRelease(changelogPath, version, date),
    commitCandidate: (version) => {
      const added = status("git", ["add", "package.json", "package-lock.json", "CHANGELOG.md"]);
      if (added !== 0) return added;
      return status("git", ["commit", "-m", `Release v${version}`]);
    },
    runReleaseCheck: () => status("npm", ["run", "release:check"]),
    runReleaseEvals: () => status("npm", ["run", "eval", "--", "release"]),
    prepareReleasePackage: () =>
      status("node", [
        "scripts/release-package.mjs",
        "prepare",
        "--out",
        "validation-output/release-package",
      ]),
    runProviderReleaseSmoke: () => status("npm", ["run", "test:providers:release"]),
    writeReleaseSummary: () =>
      status("node", [
        "scripts/release-summary.mjs",
        "--package-dir",
        "validation-output/release-package",
      ]),
    tagVersion: (tag) => status("git", ["tag", tag]),
    addUnreleasedSection: () => addUnreleasedSection(changelogPath),
    commitChangelogReset: () => {
      const added = status("git", ["add", "CHANGELOG.md"]);
      if (added !== 0) return added;
      return status("git", ["commit", "-m", "Add [Unreleased] section for next cycle"]);
    },
    pushMain: () => status("git", ["push", "origin", "main"]),
    pushTag: (tag) => status("git", ["push", "origin", tag]),
    readHeadSubject: () => capture("git", ["log", "-1", "--pretty=%s"]),
    readHeadParentSha: () => capture("git", ["rev-parse", "HEAD~1"]),
    readHeadChangedFiles: () =>
      capture("git", ["show", "--pretty=format:", "--name-only", "HEAD"])
        .split("\n")
        .filter((line) => line.trim() !== ""),
    readVersionAt: (ref) => {
      const result = run("git", ["show", `${ref}:package.json`], { capture: true });
      if (result.status !== 0) return "";
      return JSON.parse(result.stdout).version;
    },
    readChangelog: () => readFileSync(changelogPath, "utf-8"),
  };
}
