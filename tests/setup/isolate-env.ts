// Per-file env isolation for the in-process test projects (unit, site,
// agent-tools). Runs before each test file's imports, so no module under test
// ever sees the developer's credentials, the repo `.env`, or the real home.
//
// Live lanes (evals, gui-browser, gui-release, provider smokes, the tsx
// harness) do not load this file: they need the host env by design.
//
// A test that needs a value opts in per test with `vi.stubEnv(...)`; the
// projects set `unstubEnvs: true`, so the stub is undone after that test.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll } from "vitest";
import {
  CREDENTIAL_ENV_NAME,
  DATA_PROVIDER_ENV_NAMES,
  LIVE_LANE_ENV_FLAG,
  modelCredentialEnvNames,
} from "../support/env.js";

/** Names the repo `.env` defines, so none of them can be loaded by `loadEnv()`. */
function dotenvNames(path: string): string[] {
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return [];
  }
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => line.slice(0, line.indexOf("=")).trim())
    .filter(Boolean);
}

/**
 * Playwright resolves its browser cache from HOME. Pin it to the real cache
 * before HOME moves so a browser-launching helper test still finds Chromium.
 */
function playwrightBrowsersPath(realHome: string): string {
  if (process.platform === "darwin") return join(realHome, "Library", "Caches", "ms-playwright");
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? join(realHome, "AppData", "Local"), "ms-playwright");
  }
  return join(process.env.XDG_CACHE_HOME ?? join(realHome, ".cache"), "ms-playwright");
}

const snapshot = { ...process.env };
const realHome = homedir();
const isolatedRoot = mkdtempSync(join(tmpdir(), "opencandle-test-env-"));
const home = join(isolatedRoot, "home");

for (const name of Object.keys(process.env)) {
  if (LIVE_LANE_ENV_FLAG.test(name)) delete process.env[name];
}
// Blank rather than delete: `loadEnv()` only fills keys that are `undefined`,
// so an empty string also stops the repo `.env` from restoring the value.
const blanked: Record<string, string> = {};
for (const name of [...modelCredentialEnvNames(), ...DATA_PROVIDER_ENV_NAMES]) blanked[name] = "";
for (const name of Object.keys(process.env)) {
  if (CREDENTIAL_ENV_NAME.test(name)) blanked[name] = "";
}
for (const name of dotenvNames(resolve(".env"))) blanked[name] = "";
Object.assign(process.env, blanked, {
  HOME: home,
  USERPROFILE: home,
  OPENCANDLE_HOME: join(isolatedRoot, "opencandle"),
  PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
  PI_CODING_AGENT_SESSION_DIR: "",
  PLAYWRIGHT_BROWSERS_PATH: snapshot.PLAYWRIGHT_BROWSERS_PATH ?? playwrightBrowsersPath(realHome),
});

afterAll(() => {
  // Restore the worker's env so the next file's setup snapshots the real host
  // values again instead of this file's throwaway home.
  for (const name of Object.keys(process.env)) {
    if (!(name in snapshot)) delete process.env[name];
  }
  Object.assign(process.env, snapshot);
  rmSync(isolatedRoot, { recursive: true, force: true });
});
