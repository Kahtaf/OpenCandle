import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveFileConfig } from "../../../src/config.js";
import { getConfigPath } from "../../../src/infra/opencandle-paths.js";

describe.skipIf(process.platform === "win32")("config file permissions", () => {
  const originalHome = process.env.OPENCANDLE_HOME;
  const tempDirs: string[] = [];

  afterEach(() => {
    if (originalHome == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalHome;
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function useTempHome(): string {
    const home = mkdtempSync(join(tmpdir(), "opencandle-config-perms-"));
    tempDirs.push(home);
    process.env.OPENCANDLE_HOME = home;
    return home;
  }

  it("writes new config files with owner-only permissions", () => {
    useTempHome();

    saveFileConfig({ providers: { fred: { apiKey: "fred-key" } } });

    expect(statSync(getConfigPath()).mode & 0o777).toBe(0o600);
  });

  it("repairs existing config file permissions on save", () => {
    useTempHome();
    const configPath = getConfigPath();
    writeFileSync(configPath, "{}\n", { encoding: "utf-8", mode: 0o644 });
    chmodSync(configPath, 0o644);

    saveFileConfig({ providers: { fred: { apiKey: "fred-key" } } });

    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });
});
