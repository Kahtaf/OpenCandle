import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildNpmInvocation } from "../../scripts/npm-command.mjs";
import {
  handleGateResult,
  loadGatePolicy,
  resolveGateSteps,
  runGate,
  validateGatePolicy,
} from "../../scripts/test-gate.mjs";

const policyPath = fileURLToPath(new URL("../../scripts/test-gate-policy.json", import.meta.url));
const testGatePath = fileURLToPath(new URL("../../scripts/test-gate.mjs", import.meta.url));
const npmCommandPath = fileURLToPath(new URL("../../scripts/npm-command.mjs", import.meta.url));

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const EXPECTED_CORE = ["check", "test", "relay:test", "test:agent-tools"];
const EXPECTED_FULL = [
  "check",
  "test",
  "relay:test",
  "test:agent-tools",
  "test:site",
  "test:gui:integration",
  "test:gui:journey",
  "test:gui:release-smoke",
  "test:gui:hosted",
  "package:contents:check",
  "test:coverage",
];
const EXPECTED_RELEASE = [...EXPECTED_FULL, "test:packed-install", "docs:links:check"];

function makePolicy(overrides: Record<string, unknown> = {}) {
  return {
    core: [...EXPECTED_CORE],
    full: [...EXPECTED_FULL],
    release: [...EXPECTED_RELEASE],
    ...overrides,
  };
}

describe("test-gate policy", () => {
  it("ships the exact shared gate policy arrays", () => {
    const policy = loadGatePolicy(policyPath);

    expect(policy.core).toEqual(EXPECTED_CORE);
    expect(policy.full).toEqual(EXPECTED_FULL);
    expect(policy.release).toEqual(EXPECTED_RELEASE);
    // The live provider smoke is enforced by the local release and publish
    // steps, never by the deterministic gate policy.
    expect([...policy.core, ...policy.full, ...policy.release]).not.toContain(
      "test:providers:release",
    );
  });

  it("keeps full a superset of core and release a superset of full without duplicates", () => {
    expect(() => validateGatePolicy(makePolicy())).not.toThrow();

    expect(() => validateGatePolicy(makePolicy({ full: [...EXPECTED_FULL, "test:site"] }))).toThrow(
      /duplicate/i,
    );
    expect(() =>
      validateGatePolicy(makePolicy({ full: EXPECTED_FULL.filter((s) => s !== "test") })),
    ).toThrow(/core/i);
    expect(() =>
      validateGatePolicy(makePolicy({ release: EXPECTED_RELEASE.filter((s) => s !== "check") })),
    ).toThrow(/full/i);
  });

  it("rejects an empty or unknown gate", () => {
    const policy = makePolicy();
    expect(() => resolveGateSteps("nope", policy)).toThrow(/unknown gate/i);
    expect(() => validateGatePolicy(makePolicy({ core: [] }))).toThrow(/empty/i);
  });
});

describe("runGate", () => {
  it("runs each package script sequentially through npm with no shell", () => {
    const calls: Array<{ command: string; args: string[]; shell: unknown }> = [];
    const spawn = (command: string, args: string[], options: { shell?: unknown }) => {
      calls.push({ command, args, shell: options?.shell });
      return { status: 0, signal: null };
    };

    const result = runGate("core", {
      policy: makePolicy(),
      spawn,
      log: () => {},
      npmArgv: (args) => buildNpmInvocation("npm", args, { platform: "linux" }),
    });

    expect(result.ok).toBe(true);
    expect(calls.map((call) => call.command)).toEqual(EXPECTED_CORE.map(() => "npm"));
    expect(calls.map((call) => call.args)).toEqual(EXPECTED_CORE.map((name) => ["run", name]));
    for (const call of calls) expect(call.shell).toBe(false);
  });

  it("resolves npm through Node's JavaScript entrypoint on Windows without a shell", () => {
    const calls: Array<{ command: string; args: string[]; shell: unknown }> = [];
    const spawn = (command: string, args: string[], options: { shell?: unknown }) => {
      calls.push({ command, args, shell: options?.shell });
      return { status: 0, signal: null };
    };
    const execPath = "C:\\Program Files\\nodejs\\node.exe";
    const npmExecPath = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";

    const result = runGate("core", {
      policy: makePolicy(),
      spawn,
      log: () => {},
      npmArgv: (args) =>
        buildNpmInvocation("npm", args, {
          platform: "win32",
          execPath,
          env: { npm_execpath: npmExecPath },
          exists: () => true,
        }),
    });

    expect(result.ok).toBe(true);
    expect(calls[0]).toEqual({
      command: execPath,
      args: [npmExecPath, "run", "check"],
      shell: false,
    });
    for (const call of calls) expect(call.shell).toBe(false);
  });

  it("stops at the first failing script and propagates its exit code without retrying", () => {
    const calls: string[][] = [];
    const spawn = (_command: string, args: string[]) => {
      calls.push(args);
      return { status: calls.length === 2 ? 7 : 0, signal: null };
    };

    const result = runGate("core", { policy: makePolicy(), spawn, log: () => {} });

    expect(result.ok).toBe(false);
    expect(result.code).toBe(7);
    expect(result.failedStep).toBe("test");
    expect(calls).toEqual([
      ["run", "check"],
      ["run", "test"],
    ]);
  });

  it("reports a propagated signal instead of swallowing it", () => {
    const spawn = () => ({ status: null, signal: "SIGTERM" });

    const result = runGate("core", { policy: makePolicy(), spawn, log: () => {} });

    expect(result.ok).toBe(false);
    expect(result.signal).toBe("SIGTERM");
    expect(result.failedStep).toBe("check");
  });

  it("never swallows a non-zero status into a green result", () => {
    const spawn = () => ({ status: 1, signal: null });
    const result = runGate("release", { policy: makePolicy(), spawn, log: () => {} });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(1);
  });
});

describe("handleGateResult", () => {
  it("exits with the failing status code", () => {
    const exits: number[] = [];
    const kills: unknown[] = [];
    handleGateResult(
      { ok: false, code: 3, signal: null },
      { exit: (code: number) => exits.push(code), kill: (...args: unknown[]) => kills.push(args) },
    );
    expect(exits).toEqual([3]);
    expect(kills).toEqual([]);
  });

  it("re-raises a propagated signal", () => {
    const exits: number[] = [];
    const kills: unknown[] = [];
    handleGateResult(
      { ok: false, code: 1, signal: "SIGINT" },
      { exit: (code: number) => exits.push(code), kill: (...args: unknown[]) => kills.push(args) },
    );
    expect(kills.length).toBe(1);
    expect(exits).toEqual([]);
  });

  it("does nothing on success", () => {
    const exits: number[] = [];
    handleGateResult(
      { ok: true, code: 0, signal: null },
      { exit: (code: number) => exits.push(code), kill: () => {} },
    );
    expect(exits).toEqual([]);
  });
});

describe("policy file", () => {
  it("is valid JSON with only the supported gate keys", () => {
    const raw = JSON.parse(readFileSync(policyPath, "utf8")) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(["core", "full", "release"]);
  });
});

describe("test-gate CLI report", () => {
  function git(cwd: string, args: string[]): void {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }

  function setupCliRepo(scripts: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "test-gate-cli-"));
    tempRoots.push(dir);
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test"]);
    git(dir, ["config", "commit.gpgsign", "false"]);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", scripts }));
    writeFileSync(
      join(dir, "test-gate-policy.json"),
      JSON.stringify({ core: ["check"], full: ["check"], release: ["check"] }),
    );
    writeFileSync(join(dir, "test-gate.mjs"), readFileSync(testGatePath, "utf8"));
    writeFileSync(join(dir, "npm-command.mjs"), readFileSync(npmCommandPath, "utf8"));
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "init"]);
    return dir;
  }

  function readOnlyReport(dir: string): any {
    const reportDir = join(dir, "validation-output", "gates");
    const reports = readdirSync(reportDir).filter((name) => name.endsWith(".json"));
    expect(reports.length).toBe(1);
    return JSON.parse(readFileSync(join(reportDir, reports[0]), "utf8"));
  }

  it("persists a unique bounded failure report before exiting non-zero", () => {
    const dir = setupCliRepo({ check: 'node -e "process.exit(3)"' });

    const result = spawnSync(process.execPath, [join(dir, "test-gate.mjs"), "core"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, REPORT_SENTINEL: "super-secret-value" },
    });

    expect(result.status).toBe(3);
    const reportDir = join(dir, "validation-output", "gates");
    const reports = readdirSync(reportDir).filter((name) => name.endsWith(".json"));
    expect(reports.length).toBe(1);
    const text = readFileSync(join(reportDir, reports[0]), "utf8");
    expect(text).not.toContain("super-secret-value");
    const report = JSON.parse(text);
    expect(report).toMatchObject({
      schemaVersion: 1,
      gate: "core",
      overall: "failed",
      failedStep: "check",
      headChanged: false,
      insideWorkTree: true,
    });
    expect(report.candidateCommit).toMatch(/^[0-9a-f]{40,64}$/);
    expect(report.steps).toEqual([
      { step: "check", status: 3, signal: null, durationMs: expect.any(Number) },
    ]);
    expect(report.policyDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(report.node).toBe(process.version);
    expect(report.platform).toBe(`${process.platform}-${process.arch}`);
    expect(report.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects a run whose HEAD changes mid-gate even when every step passes", () => {
    const dir = setupCliRepo({
      check: 'git commit --allow-empty -q -m change && node -e "process.exit(0)"',
    });

    const result = spawnSync(process.execPath, [join(dir, "test-gate.mjs"), "core"], {
      cwd: dir,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    const report = readOnlyReport(dir);
    expect(report.overall).toBe("failed");
    expect(report.headChanged).toBe(true);
    expect(report.failedStep).toBeNull();
    expect(report.headBefore).not.toBe(report.headAfter);
    expect(report.steps).toEqual([
      { step: "check", status: 0, signal: null, durationMs: expect.any(Number) },
    ]);
  });
});
