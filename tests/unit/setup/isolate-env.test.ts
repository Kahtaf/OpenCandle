import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { getEnvApiKey, getProviders } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../../../src/config.js";
import { blankedCredentialEnv, dataProviderEnvNames } from "../../support/credential-env.js";
import { DATA_PROVIDER_ENV_NAMES } from "../../support/env.js";

// Contract: a unit test never runs with the developer's credentials or home.
// Credible defect: a missing fetch mock in any unit file that reads the repo
// `.env` (via loadEnv/getConfig/Pi session setup) would send a real key to a
// live provider, and host keys flip onboarding/setup assertions on dev machines.

// Assert blankness without ever handing a value to `expect`: if isolation
// regresses, a failure diff would otherwise print the developer's real key.
function isBlank(name: string): boolean {
  return (process.env[name] ?? "") === "";
}

function isUnder(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== "" && !rel.startsWith("..");
}

describe("unit test env isolation", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("blanks every known provider and model credential", () => {
    const names = Object.keys(blankedCredentialEnv());
    expect(names).toEqual(
      expect.arrayContaining(["GEMINI_API_KEY", "OPENAI_API_KEY", "FRED_API_KEY"]),
    );
    for (const name of names) expect(isBlank(name), name).toBe(true);
  });

  it("keeps the setup's data-provider list in step with the provider registry", () => {
    expect([...DATA_PROVIDER_ENV_NAMES].sort()).toEqual(dataProviderEnvNames().sort());
  });

  it("stops a .env file from populating a credential through loadEnv", () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-isolate-env-test-"));
    tempDirs.push(dir);
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "GEMINI_API_KEY=from-dotenv\nFRED_API_KEY=from-dotenv\n");
    loadEnv(envFile);
    expect(isBlank("GEMINI_API_KEY")).toBe(true);
    expect(isBlank("FRED_API_KEY")).toBe(true);
  });

  it("does not load the repo .env into process.env", () => {
    loadEnv(resolve(".env"));
    expect(isBlank("GEMINI_API_KEY")).toBe(true);
    expect(isBlank("OPENAI_API_KEY")).toBe(true);
  });

  it("leaves no Pi model provider signed in from the environment, ambient cloud auth included", () => {
    const signedIn = getProviders().filter((provider) => getEnvApiKey(provider, process.env));
    expect(signedIn).toEqual([]);
  });

  it("points every home-derived state location at a throwaway directory", () => {
    const home = process.env.HOME ?? "";
    expect(isUnder(home, tmpdir())).toBe(true);
    expect(homedir()).toBe(home);
    expect(process.env.USERPROFILE).toBe(home);
    expect(isUnder(process.env.OPENCANDLE_HOME ?? "", tmpdir())).toBe(true);
    expect(isUnder(process.env.PI_CODING_AGENT_DIR ?? "", tmpdir())).toBe(true);
    expect(process.env.PI_CODING_AGENT_SESSION_DIR ?? "").toBe("");
  });

  it("strips the ambient flags that change which live lanes register", () => {
    for (const name of [
      "EVAL_TIER",
      "OPENCANDLE_GUI_BROWSER",
      "OPENCANDLE_GUI_RELEASE_SMOKE",
      "OPENCANDLE_ROUTER_MODE",
      "OPENCANDLE_NOTIFICATION_WEBHOOK_URL",
    ]) {
      expect(name in process.env, name).toBe(false);
    }
  });

  it("lets a test opt in to a credential with vi.stubEnv, restored after the test", () => {
    vi.stubEnv("FRED_API_KEY", "fred-456");
    expect(process.env.FRED_API_KEY).toBe("fred-456");
  });

  it("restores the blanked value after an opt-in stub", () => {
    expect(isBlank("FRED_API_KEY")).toBe(true);
  });
});
