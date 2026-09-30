// Preflight for `npm run review:pr`: the autoreview Codex reviewer is pinned to
// gpt-6.1-sol, which older Codex CLI releases reject with a confusing
// "model is not supported" error. Fail fast with an actionable message instead.
//
// Usage: node scripts/check-codex-version.mjs [min-version]

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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

function defaultRunCommand() {
  // Codex installed through npm is a `.cmd` shim on Windows, which cannot be
  // spawned without a shell. The arguments are fixed literals, so a shell is safe.
  return spawnSync("codex", ["--version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

/** Read the installed Codex CLI version. */
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
      message: `Codex CLI was not found on PATH. review:pr needs Codex CLI >= ${minVersion} for the gpt-6.1-sol reviewer; install it with \`npm install -g @openai/codex\`.`,
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
