import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function repoPath(path: string): string {
  return resolve(repoRoot, path);
}

const tempRoots: string[] = [];

function makeFixtureRoots(): { from: string; to: string } {
  const root = mkdtempSync(join(tmpdir(), "opencandle-agent-bootstrap-"));
  const from = join(root, "from");
  const to = join(root, "to");
  mkdirSync(from);
  mkdirSync(to);
  tempRoots.push(root);
  return { from, to };
}

function runBootstrap(args: string[]) {
  return spawnSync(process.execPath, [repoPath("scripts/agent-bootstrap.mjs"), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("agent developer guardrails", () => {
  it("keeps AGENTS.md below the project-doc injection budget headroom", () => {
    const byteLength = readFileSync(repoPath("AGENTS.md")).byteLength;

    expect(
      byteLength,
      "AGENTS.md must stay at or below 24576 bytes so it retains headroom under the 32768-byte Codex project-doc injection budget",
    ).toBeLessThanOrEqual(24_576);
  });

  it("links the canonical agent commands and delegation contract from AGENTS.md", () => {
    const agents = readFileSync(repoPath("AGENTS.md"), "utf8");

    for (const requiredReference of [
      "npm run gates",
      "npm run bootstrap:agent",
      ".agents/delegation/subagent-contract.md",
    ]) {
      expect(agents).toContain(requiredReference);
    }
  });

  it("pins the canonical package scripts", () => {
    const packageJson = JSON.parse(readFileSync(repoPath("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.typecheck).toBe("tsc --noEmit");
    expect(packageJson.scripts["relay:typecheck"]).toBe(
      "npm --workspace @opencandle/provider-relay run typecheck",
    );
    expect(packageJson.scripts.gates).toBe(
      "npm run typecheck && npm run relay:typecheck && npx biome ci . && npm run gui:hosted:build && npm test && npm run relay:test && npm run test:agent-tools",
    );
    expect(packageJson.scripts["bootstrap:agent"]).toBe("node scripts/agent-bootstrap.mjs");
    expect(packageJson.scripts["review:pr"]).toContain("npm run gates");
  });

  it("pins the delegation contract fields and standing clauses", () => {
    const contractPath = repoPath(".agents/delegation/subagent-contract.md");
    expect(existsSync(contractPath)).toBe(true);
    if (!existsSync(contractPath)) return;

    const contract = readFileSync(contractPath, "utf8");
    for (const requiredPhrase of [
      "Owned tasks",
      "Commit policy",
      "Branch",
      "Test scope",
      "Extra constraints",
      "bootstrap:agent",
      "stop and report",
      "failing test",
      "npm run gates",
      "do not check off",
      "evals pass",
      "credentials",
      "never print",
      "CHANGELOG",
      "graphify update",
      "Codex review",
    ]) {
      expect(contract).toContain(requiredPhrase);
    }
  });

  it("pins the resume template handoff instructions", () => {
    const resumePath = repoPath(".agents/delegation/resume-template.md");
    expect(existsSync(resumePath)).toBe(true);
    if (!existsSync(resumePath)) return;

    const resumeTemplate = readFileSync(resumePath, "utf8");
    expect(resumeTemplate).toContain("working tree");
    expect(resumeTemplate).toContain("npm run gates");
  });

  describe("agent bootstrap", () => {
    it("copies a missing env file securely without printing its value", () => {
      const { from, to } = makeFixtureRoots();
      writeFileSync(join(from, ".env"), "SECRET=value1\n");

      const result = runBootstrap(["--from", from, "--to", to, "--skip-install"]);

      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(join(to, ".env"))).toBe(true);
      if (!existsSync(join(to, ".env"))) return;
      expect(readFileSync(join(to, ".env"), "utf8")).toBe("SECRET=value1\n");
      expect(statSync(join(to, ".env")).mode & 0o777).toBe(0o600);
      expect(result.stdout).toContain("env: copied");
      expect(result.stdout).not.toContain("value1");
    });

    it("preserves an existing env file byte-for-byte", () => {
      const { from, to } = makeFixtureRoots();
      writeFileSync(join(from, ".env"), "SECRET=value1\n");
      writeFileSync(join(to, ".env"), "SECRET=destination-value\n");
      const before = readFileSync(join(to, ".env"));

      const result = runBootstrap(["--from", from, "--to", to, "--skip-install"]);

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(join(to, ".env"))).toEqual(before);
      expect(result.stdout).toContain("env: present");
    });

    it("copies the env file with an atomically exclusive write", () => {
      // The check-then-copy race cannot be triggered deterministically from the
      // CLI, so pin the exclusive-copy implementation at the source level.
      const bootstrapSource = readFileSync(repoPath("scripts/agent-bootstrap.mjs"), "utf8");

      expect(bootstrapSource).toContain("COPYFILE_EXCL");
      expect(bootstrapSource).toContain("EEXIST");
    });

    it("skips dependency installation under an unsupported Node version", () => {
      // An unsupported runtime cannot be simulated from the test process, so
      // pin the guard at the source level: deps must not install when the
      // Node check already failed (native builds under the wrong Node leave a
      // worktree that needs rebuilding).
      const bootstrapSource = readFileSync(repoPath("scripts/agent-bootstrap.mjs"), "utf8");

      expect(bootstrapSource).toContain("skipped (unsupported node)");
      expect(bootstrapSource.indexOf("nodeError")).toBeGreaterThan(-1);
      expect(bootstrapSource.indexOf("nodeError")).toBeLessThan(
        bootstrapSource.indexOf("prepareDependencies(roots.currentRoot"),
      );
    });

    it("treats a missing source env as a warning", () => {
      const { from, to } = makeFixtureRoots();

      const result = runBootstrap(["--from", from, "--to", to, "--skip-install"]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("env: missing-source");
    });

    it("reports a planned env copy without changing files in dry-run mode", () => {
      const { from, to } = makeFixtureRoots();
      writeFileSync(join(from, ".env"), "SECRET=value1\n");

      const result = runBootstrap(["--from", from, "--to", to, "--skip-install", "--dry-run"]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("env: copied (planned, dry-run)");
      expect(existsSync(join(to, ".env"))).toBe(false);
    });

    it("reports real-repo readiness and the canonical proof command", () => {
      const result = runBootstrap(["--skip-install", "--dry-run"]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/^branch:/m);
      expect(result.stdout).toMatch(/^node:/m);
      expect(result.stdout).toMatch(/^env:/m);
      expect(result.stdout).toMatch(/^deps:/m);
      expect(result.stdout).toMatch(/^ready:.*npm run gates/m);
    });
  });
});
