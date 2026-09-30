// Preflight for `npm run review:pr`: the autoreview Codex reviewer is pinned to
// gpt-6.1-sol, which older Codex CLI releases reject with a confusing
// "model is not supported" error. Fail fast with an actionable message instead.
//
// Usage: node scripts/check-codex-version.mjs [min-version]

import { spawnSync } from "node:child_process";
import { accessSync, constants, realpathSync } from "node:fs";
import { posix, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Minimum Codex CLI that accepts the gpt-6.1-sol reviewer model. */
export const MIN_CODEX_VERSION = "0.159.0";

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** Extract `X.Y.Z` from `codex --version` output (`codex-cli X.Y.Z`), or null. */
export function parseCodexVersion(output) {
  const match = /codex-cli\s+(\d+\.\d+\.\d+)/.exec(output ?? "");
  return match ? match[1] : null;
}

/** Numeric per-component comparison of two `X.Y.Z` versions. */
export function compareVersions(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

const defaultRepoRoot = fileURLToPath(new URL("..", import.meta.url));

function isExecutableFile(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function realpathOrSelf(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Resolve the Codex binary exactly as autoreview's `find_command` does, so the
 * preflight probes the binary the reviewer will run: `CODEX_BIN` when set
 * (relative paths resolve against the repo root), otherwise the first PATH
 * entry that is absolute, not a `node_modules/.bin` shim directory, and not
 * inside the repo. Returns null when no trusted binary exists.
 */
export function resolveCodexBinary({
  env = process.env,
  repoRoot = defaultRepoRoot,
  platform = process.platform,
  isExecutable = isExecutableFile,
  realpath = realpathOrSelf,
} = {}) {
  const path = platform === "win32" ? win32 : posix;
  const extensions =
    platform === "win32"
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter(Boolean)
          .map((extension) => extension.toLowerCase())
      : [""];
  const firstExecutable = (base) => {
    const candidates =
      platform === "win32" && !path.extname(base)
        ? extensions.map((extension) => `${base}${extension}`)
        : [base];
    return candidates.find((candidate) => isExecutable(candidate)) ?? null;
  };

  const name = env.CODEX_BIN || "codex";
  const root = realpath(repoRoot);
  if (
    path.isAbsolute(name) ||
    name.includes("/") ||
    (platform === "win32" && name.includes("\\"))
  ) {
    return firstExecutable(path.isAbsolute(name) ? name : path.join(root, name));
  }

  const separator = platform === "win32" ? ";" : ":";
  for (const entry of (env.PATH ?? "").split(separator)) {
    if (!entry || entry === "." || !path.isAbsolute(entry)) continue;
    const directory = realpath(entry);
    const isNodeModulesBin =
      path.basename(directory) === ".bin" &&
      path.basename(path.dirname(directory)) === "node_modules";
    const relative = path.relative(root, directory);
    const isWithinRepo =
      relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    if (isNodeModulesBin || isWithinRepo) continue;
    const found = firstExecutable(path.join(directory, name));
    if (found) return found;
  }
  return null;
}

function defaultRunCommand() {
  const binary = resolveCodexBinary();
  if (!binary)
    return { status: null, error: Object.assign(new Error("codex not found"), { code: "ENOENT" }) };
  // Codex installed through npm is a `.cmd` shim on Windows, which cannot be
  // spawned without a shell. The path is quoted and the argument is a fixed literal.
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(binary)) {
    return spawnSync(`"${binary}"`, ["--version"], { encoding: "utf8", shell: true });
  }
  return spawnSync(binary, ["--version"], { encoding: "utf8" });
}

/** Read the version of the Codex CLI that autoreview will run. */
export function getCodexVersion({ runCommand = defaultRunCommand } = {}) {
  const result = runCommand();
  if (result.error) {
    return result.error.code === "ENOENT" ? { status: "missing" } : { status: "unknown" };
  }
  if (result.status !== 0) return { status: "unknown" };
  const version = parseCodexVersion(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  return version ? { status: "ok", version } : { status: "unknown" };
}

/** Check the installed Codex CLI against `minVersion`. */
export function checkCodexVersion(minVersion = MIN_CODEX_VERSION, options = {}) {
  if (!VERSION_PATTERN.test(minVersion)) {
    throw new Error(`Invalid minimum Codex version "${minVersion}"; expected X.Y.Z.`);
  }

  const detected = getCodexVersion(options);
  if (detected.status === "missing") {
    return {
      ok: false,
      status: "missing",
      message: `Codex CLI was not found (set CODEX_BIN or add it to PATH outside node_modules/.bin). review:pr needs Codex CLI >= ${minVersion} for the gpt-6.1-sol reviewer; install it with \`npm install -g @openai/codex\`.`,
    };
  }
  if (detected.status === "unknown") {
    return {
      ok: false,
      status: "unknown",
      message: `Could not determine the Codex CLI version from \`codex --version\`. review:pr needs Codex CLI >= ${minVersion} for the gpt-6.1-sol reviewer; run \`codex update\`.`,
    };
  }
  if (compareVersions(detected.version, minVersion) < 0) {
    return {
      ok: false,
      status: "outdated",
      version: detected.version,
      message: `Codex CLI ${detected.version} is older than ${minVersion} required for the gpt-6.1-sol reviewer; run \`codex update\`.`,
    };
  }
  return { ok: true, status: "ok", version: detected.version, message: null };
}

function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMain()) {
  try {
    const result = checkCodexVersion(process.argv[2] ?? MIN_CODEX_VERSION);
    if (!result.ok) {
      console.error(result.message);
      process.exit(1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
