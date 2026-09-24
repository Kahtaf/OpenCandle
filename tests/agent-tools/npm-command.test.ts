import { readFileSync } from "node:fs";
import { join, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildNpmInvocation,
  npmCliCandidatePaths,
  resolveNpmCommand,
} from "../../scripts/npm-command.mjs";
import { resolveInstalledCli } from "../../scripts/packed-install-smoke.mjs";

const WINDOWS_EXEC_PATH = "C:\\Program Files\\nodejs\\node.exe";
const WINDOWS_NPM_EXECPATH = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";

describe("resolveNpmCommand on POSIX", () => {
  it("keeps the bare npm and npx commands with no argument prefix", () => {
    for (const tool of ["npm", "npx"]) {
      expect(
        resolveNpmCommand(tool, {
          platform: "linux",
          env: { npm_execpath: "/usr/lib/node_modules/npm/bin/npm-cli.js" },
        }),
      ).toEqual({ command: tool, args: [] });
    }
  });
});

describe("resolveNpmCommand on Windows", () => {
  it("runs npm through process.execPath instead of the npm.cmd shim", () => {
    expect(
      resolveNpmCommand("npm", {
        platform: "win32",
        execPath: WINDOWS_EXEC_PATH,
        env: { npm_execpath: WINDOWS_NPM_EXECPATH },
        exists: () => true,
      }),
    ).toEqual({ command: WINDOWS_EXEC_PATH, args: [WINDOWS_NPM_EXECPATH] });
  });

  it("derives the npx entrypoint from the npm entrypoint directory", () => {
    const npxExecPath = win32.join(win32.dirname(WINDOWS_NPM_EXECPATH), "npx-cli.js");
    const invocation = resolveNpmCommand("npx", {
      platform: "win32",
      execPath: WINDOWS_EXEC_PATH,
      env: { npm_execpath: WINDOWS_NPM_EXECPATH },
      exists: (candidate) => candidate === npxExecPath,
    });

    expect(invocation).toEqual({ command: WINDOWS_EXEC_PATH, args: [npxExecPath] });
  });

  it("falls back to the installation layout when npm_execpath is absent", () => {
    const entrypoint = win32.join("C:\\nodejs", "node_modules", "npm", "bin", "npm-cli.js");
    const invocation = resolveNpmCommand("npm", {
      platform: "win32",
      execPath: "C:\\nodejs\\node.exe",
      env: {},
      exists: (candidate) => candidate === entrypoint,
    });

    expect(invocation).toEqual({ command: "C:\\nodejs\\node.exe", args: [entrypoint] });
  });

  it("falls back to the npm global prefix layout", () => {
    const entrypoint = win32.join("C:\\npm-global", "node_modules", "npm", "bin", "npm-cli.js");
    const invocation = resolveNpmCommand("npm", {
      platform: "win32",
      execPath: "C:\\nodejs\\node.exe",
      env: { npm_config_global_prefix: "C:\\npm-global" },
      exists: (candidate) => candidate === entrypoint,
    });

    expect(invocation.args).toEqual([entrypoint]);
  });

  it("reports a clear error listing the missing entrypoints when none exist", () => {
    const candidates = npmCliCandidatePaths("npm", {
      platform: "win32",
      execPath: WINDOWS_EXEC_PATH,
      env: { npm_execpath: WINDOWS_NPM_EXECPATH },
    });

    expect(() =>
      resolveNpmCommand("npm", {
        platform: "win32",
        execPath: WINDOWS_EXEC_PATH,
        env: { npm_execpath: WINDOWS_NPM_EXECPATH },
        exists: () => false,
      }),
    ).toThrow(/Cannot locate the npm JavaScript entrypoint on Windows/i);

    // The error must name the exact paths that were attempted so a Windows
    // failure is diagnosable without the shim.
    let message = "";
    try {
      resolveNpmCommand("npm", {
        platform: "win32",
        execPath: WINDOWS_EXEC_PATH,
        env: { npm_execpath: WINDOWS_NPM_EXECPATH },
        exists: () => false,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    for (const candidate of candidates) {
      expect(message).toContain(candidate);
    }
  });
});

describe("buildNpmInvocation", () => {
  it("prefixes npm arguments with the Node binary and JS entrypoint", () => {
    const invocation = buildNpmInvocation("npm", ["run", "prepare"], {
      platform: "win32",
      execPath: WINDOWS_EXEC_PATH,
      env: { npm_execpath: WINDOWS_NPM_EXECPATH },
      exists: () => true,
    });

    expect(invocation).toEqual({
      command: WINDOWS_EXEC_PATH,
      args: [WINDOWS_NPM_EXECPATH, "run", "prepare"],
    });
  });

  it("retains literal paths with spaces and metacharacters as a single argument", () => {
    const tarball = "C:\\Users\\a b\\AppData\\Local\\Temp\\oc & smoke; `x`.tgz";
    const invocation = buildNpmInvocation("npm", ["install", "--no-audit", "--no-fund", tarball], {
      platform: "win32",
      execPath: WINDOWS_EXEC_PATH,
      env: { npm_execpath: WINDOWS_NPM_EXECPATH },
      exists: () => true,
    });

    expect(invocation.command).toBe(WINDOWS_EXEC_PATH);
    expect(invocation.args[invocation.args.length - 1]).toBe(tarball);
    expect(invocation.args).toEqual([
      WINDOWS_NPM_EXECPATH,
      "install",
      "--no-audit",
      "--no-fund",
      tarball,
    ]);
  });
});

const INSTALLED_PACKAGE_DIR = "/tmp/consumer";
const INSTALLED_BIN = join(INSTALLED_PACKAGE_DIR, "node_modules", "opencandle", "dist", "cli.js");

describe("resolveInstalledCli", () => {
  it("runs the installed bin JavaScript through process.execPath on Windows", () => {
    expect(
      resolveInstalledCli(
        INSTALLED_PACKAGE_DIR,
        { name: "opencandle", bin: { opencandle: "dist/cli.js" } },
        "win32",
      ),
    ).toEqual({ command: process.execPath, args: [INSTALLED_BIN] });
  });

  it("accepts a string bin field", () => {
    const invocation = resolveInstalledCli(
      INSTALLED_PACKAGE_DIR,
      { name: "opencandle", bin: "dist/cli.js" },
      "win32",
    );
    expect(invocation.command).toBe(process.execPath);
    expect(invocation.args).toEqual([INSTALLED_BIN]);
  });

  it("rejects a bin entry that escapes the package directory", () => {
    expect(() =>
      resolveInstalledCli(
        INSTALLED_PACKAGE_DIR,
        { name: "opencandle", bin: { opencandle: "../../evil.js" } },
        "win32",
      ),
    ).toThrow(/escapes the package directory/i);
  });

  it("rejects a manifest with no bin entry", () => {
    expect(() =>
      resolveInstalledCli(INSTALLED_PACKAGE_DIR, { name: "opencandle" }, "win32"),
    ).toThrow(/bin entry/i);
  });

  it("keeps the node_modules/.bin install shim on POSIX", () => {
    expect(resolveInstalledCli(INSTALLED_PACKAGE_DIR, { name: "opencandle" }, "linux")).toEqual({
      command: join(INSTALLED_PACKAGE_DIR, "node_modules", ".bin", "opencandle"),
      args: [],
    });
  });
});

describe("Windows shim consumers", () => {
  const consumers = [
    "scripts/build-gui-server.mjs",
    "scripts/check-node-version-lib.mjs",
    "scripts/agent-bootstrap.mjs",
    "scripts/packed-install-smoke.mjs",
  ];

  for (const file of consumers) {
    it(`${file} never spawns a .cmd shim or a shell`, () => {
      const source = readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), "utf8");
      expect(source).toContain("buildNpmInvocation");
      expect(source).not.toMatch(/"npm\.cmd"|"npx\.cmd"|"opencandle\.cmd"/);
      expect(source).not.toMatch(/shell:\s*true/);
    });
  }
});
