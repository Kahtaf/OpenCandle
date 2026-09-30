import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkCodexVersion,
  compareVersions,
  MIN_CODEX_VERSION,
  parseCodexVersion,
  resolveCodexBinary,
  reviewUsesCodex,
} from "../../scripts/check-codex-version.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeTempDir(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "opencandle-codex-bin-")));
  tempRoots.push(root);
  return root;
}

function writeFakeCodex(directory: string, version: string): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "codex");
  writeFileSync(path, `#!/bin/sh\necho "codex-cli ${version}"\n`, { mode: 0o755 });
  return path;
}

function runnerReturning(result: { status: number | null; stdout?: string; error?: unknown }) {
  return () => ({ stdout: "", stderr: "", ...result });
}

describe("parseCodexVersion", () => {
  it("extracts the semantic version from codex --version output", () => {
    expect(parseCodexVersion("codex-cli 0.159.2\n")).toBe("0.159.2");
    expect(parseCodexVersion("codex-cli 0.160.0-alpha.3")).toBe("0.160.0");
  });

  it("returns null for output that is not a codex-cli version", () => {
    expect(parseCodexVersion("")).toBeNull();
    expect(parseCodexVersion("command not found")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("compares numerically per component, not lexically", () => {
    expect(compareVersions("0.157.1", "0.159.0")).toBeLessThan(0);
    expect(compareVersions("0.159.0", "0.159.0")).toBe(0);
    expect(compareVersions("0.159.2", "0.159.0")).toBeGreaterThan(0);
    expect(compareVersions("0.1000.0", "0.159.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.999.999")).toBeGreaterThan(0);
  });
});

describe("checkCodexVersion", () => {
  it("passes when the installed codex meets the minimum", () => {
    const result = checkCodexVersion("0.159.0", {
      runCommand: runnerReturning({ status: 0, stdout: "codex-cli 0.159.2\n" }),
    });

    expect(result).toMatchObject({ ok: true, status: "ok", version: "0.159.2" });
  });

  it("fails with an actionable update message when codex is too old", () => {
    const result = checkCodexVersion("0.159.0", {
      runCommand: runnerReturning({ status: 0, stdout: "codex-cli 0.157.1\n" }),
    });

    expect(result).toMatchObject({ ok: false, status: "outdated", version: "0.157.1" });
    expect(result.message).toContain("Codex CLI 0.157.1 is older than 0.159.0");
    expect(result.message).toContain("gpt-6.1-sol");
    expect(result.message).toContain("codex update");
  });

  it("fails clearly when codex is not installed", () => {
    const missing = Object.assign(new Error("spawnSync codex ENOENT"), { code: "ENOENT" });
    const result = checkCodexVersion("0.159.0", {
      runCommand: runnerReturning({ status: null, error: missing }),
    });

    expect(result).toMatchObject({ ok: false, status: "missing" });
    expect(result.message).toContain("Codex CLI was not found");
    expect(result.message).toContain(">= 0.159.0");
  });

  it("fails clearly when the version output cannot be parsed", () => {
    const result = checkCodexVersion("0.159.0", {
      runCommand: runnerReturning({ status: 0, stdout: "something unexpected" }),
    });

    expect(result).toMatchObject({ ok: false, status: "unknown" });
    expect(result.message).toContain("Could not determine the Codex CLI version");
  });

  it("rejects an invalid minimum version", () => {
    expect(() =>
      checkCodexVersion("latest", {
        runCommand: runnerReturning({ status: 0, stdout: "codex-cli 0.159.2" }),
      }),
    ).toThrow(/invalid minimum/i);
  });
});

describe("resolveCodexBinary", () => {
  const isExecutable = (candidates: string[]) => (path: string) => candidates.includes(path);

  it("uses CODEX_BIN when set, resolving a relative path against the repo root", () => {
    expect(
      resolveCodexBinary({
        env: { CODEX_BIN: "/opt/codex/bin/codex", PATH: "/usr/bin" },
        repoRoot: "/repo",
        platform: "linux",
        isExecutable: isExecutable(["/opt/codex/bin/codex"]),
      }),
    ).toBe("/opt/codex/bin/codex");
    expect(
      resolveCodexBinary({
        env: { CODEX_BIN: "tools/codex", PATH: "" },
        repoRoot: "/repo",
        platform: "linux",
        isExecutable: isExecutable(["/repo/tools/codex"]),
      }),
    ).toBe("/repo/tools/codex");
  });

  it("skips node_modules/.bin, in-repo, and relative PATH entries like autoreview", () => {
    const path = [
      "/repo/node_modules/.bin",
      "/elsewhere/node_modules/.bin",
      "/repo/scripts",
      "relative/bin",
      ".",
      "",
      "/usr/local/bin",
    ].join(":");

    expect(
      resolveCodexBinary({
        env: { PATH: path },
        repoRoot: "/repo",
        platform: "linux",
        isExecutable: () => true,
      }),
    ).toBe("/usr/local/bin/codex");
  });

  it("returns null when no trusted codex binary exists", () => {
    expect(
      resolveCodexBinary({
        env: { PATH: "/repo/node_modules/.bin:/usr/bin" },
        repoRoot: "/repo",
        platform: "linux",
        isExecutable: (candidate) => candidate === "/repo/node_modules/.bin/codex",
      }),
    ).toBeNull();
  });
});

describe.skipIf(process.platform === "win32")("check-codex-version CLI binary selection", () => {
  function runCli(env: NodeJS.ProcessEnv) {
    return spawnSync(process.execPath, [resolve(repoRoot, "scripts/check-codex-version.mjs")], {
      cwd: repoRoot,
      encoding: "utf8",
      env,
    });
  }

  it("probes CODEX_BIN instead of the codex on PATH", () => {
    const root = makeTempDir();
    const pathDir = join(root, "path");
    writeFakeCodex(pathDir, "0.157.1");
    const configured = writeFakeCodex(join(root, "configured"), "0.159.2");

    const result = runCli({ ...process.env, PATH: pathDir, CODEX_BIN: configured });

    expect(result.status, result.stderr).toBe(0);
  });

  it("ignores an outdated codex shim in node_modules/.bin", () => {
    const root = makeTempDir();
    const shimDir = join(root, "node_modules", ".bin");
    writeFakeCodex(shimDir, "0.100.0");
    const globalDir = join(root, "global");
    writeFakeCodex(globalDir, "0.159.2");
    const env = { ...process.env, PATH: `${shimDir}${delimiter}${globalDir}` };
    delete env.CODEX_BIN;

    const result = runCli(env);

    expect(result.status, result.stderr).toBe(0);
  });
});

describe("reviewUsesCodex", () => {
  it("checks Codex only when autoreview will run the Codex engine", () => {
    expect(reviewUsesCodex({})).toBe(true);
    expect(reviewUsesCodex({ AUTOREVIEW_ENGINE: "codex" })).toBe(true);
    for (const engine of ["claude", "droid", "copilot"]) {
      expect(reviewUsesCodex({ AUTOREVIEW_ENGINE: engine })).toBe(false);
    }
  });

  it("skips the CLI check for a non-Codex engine even with no codex installed", () => {
    const env = { ...process.env, AUTOREVIEW_ENGINE: "claude", PATH: "", CODEX_BIN: "" };
    const result = spawnSync(
      process.execPath,
      [resolve(repoRoot, "scripts/check-codex-version.mjs")],
      { cwd: repoRoot, encoding: "utf8", env },
    );

    expect(result.status, result.stderr).toBe(0);
  });
});

describe("review:pr preflight", () => {
  it("gates review:pr on the codex version preflight before autoreview runs", () => {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const reviewScript = packageJson.scripts["review:pr"];

    expect(reviewScript.startsWith("node scripts/check-codex-version.mjs && ")).toBe(true);
    expect(reviewScript).toContain(".agents/skills/autoreview/scripts/autoreview");
  });

  it("keeps the minimum version in the shared constant", () => {
    expect(MIN_CODEX_VERSION).toBe("0.159.0");
  });

  it("exits non-zero from the CLI when an unreachable minimum is required", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(repoRoot, "scripts/check-codex-version.mjs"), "999999.0.0"],
      { cwd: repoRoot, encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Codex CLI/);
  });
});
