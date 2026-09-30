import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkCodexVersion,
  compareVersions,
  MIN_CODEX_VERSION,
  parseCodexVersion,
} from "../../scripts/check-codex-version.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

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
